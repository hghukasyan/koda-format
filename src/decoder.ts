/**
 * KODA binary decoding (.kod). SPEC §6.
 */

import type { KodaValue } from './ast.js';
import { KodaDecodeError } from './errors.js';

const MAGIC = new Uint8Array([0x4b, 0x4f, 0x44, 0x41]);
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

export interface DecodeOptions {
  /** Max nesting depth (default 256) */
  maxDepth?: number;
  /** Max dictionary size (default 65536) */
  maxDictionarySize?: number;
  /** Max string length (default 1_000_000) */
  maxStringLength?: number;
}

const DEFAULT_MAX_DEPTH = 256;
const DEFAULT_MAX_DICT = 65536;
const DEFAULT_MAX_STRING = 1_000_000;

/**
 * Decode KODA binary buffer to a KODA value.
 */
export function decode(buffer: Uint8Array, options: DecodeOptions = {}): KodaValue {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxDict = options.maxDictionarySize ?? DEFAULT_MAX_DICT;
  const maxStr = options.maxStringLength ?? DEFAULT_MAX_STRING;
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);

  function fail(message: string): never {
    throw new KodaDecodeError(message, { byteOffset: offset });
  }

  function ensure(n: number): void {
    if (offset + n > buffer.length) fail('Truncated input');
  }

  function readU8(): number {
    ensure(1);
    return buffer[offset++]!;
  }

  function readU32(): number {
    ensure(4);
    const v = view.getUint32(offset, false);
    offset += 4;
    return v;
  }

  function readI64(): bigint {
    ensure(8);
    const v = view.getBigInt64(offset, false);
    offset += 8;
    return v;
  }

  function readF64(): number {
    ensure(8);
    const v = view.getFloat64(offset, false);
    offset += 8;
    return v;
  }

  function readBytes(n: number): Uint8Array {
    ensure(n);
    const slice = buffer.subarray(offset, offset + n);
    offset += n;
    return slice;
  }

  function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  ensure(5);
  for (let i = 0; i < 4; i++) {
    if (buffer[offset + i] !== MAGIC[i]) fail('Invalid magic number');
  }
  offset += 4;
  const version = readU8();
  if (version !== VERSION) fail(`Unsupported version: ${version}`);

  const dictLen = readU32();
  if (dictLen > maxDict) fail('Dictionary too large');
  const dictionary: string[] = new Array(dictLen);
  for (let i = 0; i < dictLen; i++) {
    const keyLen = readU32();
    if (keyLen > maxStr) fail('Key string too long');
    const keyBytes = readBytes(keyLen);
    dictionary[i] = decodeUtf8(keyBytes);
  }

  function decodeValue(depth: number): KodaValue {
    if (depth > maxDepth) fail('Maximum nesting depth exceeded');
    ensure(1);
    const tag = readU8();
    switch (tag) {
      case Tag.Null:
        return null;
      case Tag.False:
        return false;
      case Tag.True:
        return true;
      case Tag.Integer: {
        const big = readI64();
        if (big >= Number.MIN_SAFE_INTEGER && big <= Number.MAX_SAFE_INTEGER) {
          return Number(big);
        }
        return Number(big);
      }
      case Tag.Float:
        return readF64();
      case Tag.String: {
        const len = readU32();
        if (len > maxStr) fail('String too long');
        const bytes = readBytes(len);
        return decodeUtf8(bytes);
      }
      case Tag.Binary:
        fail('Binary type not supported in this version');
      case Tag.Array: {
        const count = readU32();
        const arr: KodaValue[] = new Array(count);
        for (let i = 0; i < count; i++) arr[i] = decodeValue(depth + 1);
        return arr;
      }
      case Tag.Object: {
        const count = readU32();
        const obj: Record<string, KodaValue> = {};
        for (let i = 0; i < count; i++) {
          const keyIdx = readU32();
          if (keyIdx >= dictionary.length) fail('Invalid key index');
          const key = dictionary[keyIdx]!;
          obj[key] = decodeValue(depth + 1);
        }
        return obj;
      }
      default:
        fail(`Unknown type tag: 0x${tag.toString(16)}`);
    }
  }

  const value = decodeValue(0);
  if (offset !== buffer.length) fail('Trailing bytes after root value');
  return value;
}
