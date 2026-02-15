/**
 * KODA canonical binary encoding (.kod). SPEC §6.
 * Deterministic; key dictionary stored once; big-endian.
 */

import type { KodaValue } from './ast.js';
import { KodaEncodeError } from './errors.js';

const MAGIC = new Uint8Array([0x4b, 0x4f, 0x44, 0x41]); // "KODA"
const VERSION = 1;

const enum Tag {
  Null = 0x01,
  False = 0x02,
  True = 0x03,
  Integer = 0x04,
  Float = 0x05,
  String = 0x06,
  Binary = 0x07,
  Array = 0x10,
  Object = 0x11,
}

const MIN_SAFE_INT64 = -0x8000_0000_0000_0000n;
const MAX_SAFE_INT64 = 0x7fff_ffff_ffff_ffffn;

function collectKeys(value: KodaValue, set: Set<string>): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, set);
    return;
  }
  const obj = value as Record<string, KodaValue>;
  for (const k of Object.keys(obj)) {
    set.add(k);
    collectKeys(obj[k]!, set);
  }
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export interface EncodeOptions {
  /** Max nesting depth (default 256) */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 256;

/**
 * Encode a KODA value to canonical binary form.
 */
export function encode(value: KodaValue, options: EncodeOptions = {}): Uint8Array {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const keysSet = new Set<string>();
  collectKeys(value, keysSet);
  const dictionary = [...keysSet].sort((a, b) => {
    const aa = encodeUtf8(a);
    const bb = encodeUtf8(b);
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      if (aa[i]! !== bb[i]!) return aa[i]! - bb[i]!;
    }
    return aa.length - bb.length;
  });
  const keyToIndex = new Map<string, number>();
  dictionary.forEach((k, i) => keyToIndex.set(k, i));

  const INITIAL = 4096;
  let buf = new Uint8Array(INITIAL);
  let off = 0;
  function ensure(n: number): void {
    if (off + n > buf.length) {
      const next = new Uint8Array(Math.max(buf.length * 2, off + n));
      next.set(buf.subarray(0, off));
      buf = next;
    }
  }
  function write(b: Uint8Array): void {
    ensure(b.length);
    buf.set(b, off);
    off += b.length;
  }
  function writeByte(x: number): void {
    ensure(1);
    buf[off++] = x;
  }

  write(MAGIC);
  writeByte(VERSION);

  const dictCount = dictionary.length;
  const dictCountBuf = new ArrayBuffer(4);
  new DataView(dictCountBuf).setUint32(0, dictCount, false);
  write(new Uint8Array(dictCountBuf));
  for (const k of dictionary) {
    const bytes = encodeUtf8(k);
    const lenBuf = new ArrayBuffer(4);
    new DataView(lenBuf).setUint32(0, bytes.length, false);
    write(new Uint8Array(lenBuf));
    write(bytes);
  }

  function encodeValue(v: KodaValue, depth: number): void {
    if (depth > maxDepth) {
      throw new KodaEncodeError('Maximum nesting depth exceeded', { byteOffset: off });
    }
    if (v === null) {
      writeByte(Tag.Null);
      return;
    }
    if (v === false) {
      writeByte(Tag.False);
      return;
    }
    if (v === true) {
      writeByte(Tag.True);
      return;
    }
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER) {
        const big = BigInt(v);
        if (big >= MIN_SAFE_INT64 && big <= MAX_SAFE_INT64) {
          writeByte(Tag.Integer);
          ensure(8);
          new DataView(buf.buffer, buf.byteOffset + off, 8).setBigInt64(0, big, false);
          off += 8;
          return;
        }
      }
      writeByte(Tag.Float);
      ensure(8);
      new DataView(buf.buffer, buf.byteOffset + off, 8).setFloat64(0, v, false);
      off += 8;
      return;
    }
    if (typeof v === 'string') {
      const bytes = encodeUtf8(v);
      writeByte(Tag.String);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, bytes.length, false);
      write(new Uint8Array(lenBuf));
      write(bytes);
      return;
    }
    if (Array.isArray(v)) {
      writeByte(Tag.Array);
      const lenBuf = new ArrayBuffer(4);
      new DataView(lenBuf).setUint32(0, v.length, false);
      write(new Uint8Array(lenBuf));
      for (const item of v) encodeValue(item, depth + 1);
      return;
    }
    const obj = v as Record<string, KodaValue>;
    const sortedKeys = Object.keys(obj).sort((a, b) => {
      const aa = encodeUtf8(a);
      const bb = encodeUtf8(b);
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        if (aa[i]! !== bb[i]!) return aa[i]! - bb[i]!;
      }
      return aa.length - bb.length;
    });
    writeByte(Tag.Object);
    const countBuf = new ArrayBuffer(4);
    new DataView(countBuf).setUint32(0, sortedKeys.length, false);
    write(new Uint8Array(countBuf));
    for (const key of sortedKeys) {
      const idx = keyToIndex.get(key);
      if (idx === undefined) throw new KodaEncodeError('Key not in dictionary', { byteOffset: off });
      const idxBuf = new ArrayBuffer(4);
      new DataView(idxBuf).setUint32(0, idx, false);
      write(new Uint8Array(idxBuf));
      encodeValue(obj[key]!, depth + 1);
    }
  }

  encodeValue(value, 0);

  return off === buf.length ? buf : buf.subarray(0, off);
}
