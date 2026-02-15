/**
 * Single-pass KODA parser. No token array; reads on the fly for speed.
 * Same grammar as parser.ts; use for default parse() when speed matters.
 */

import type { KodaValue } from './ast.js';
import { KodaParseError } from './errors.js';

const enum K {
  Eof,
  LBrace,
  RBrace,
  LBracket,
  RBracket,
  Colon,
  Comma,
  String,
  Identifier,
  Integer,
  Float,
  True,
  False,
  Null,
}

export interface ParseOptions {
  maxDepth?: number;
  maxInputLength?: number;
}

const DEFAULT_MAX_DEPTH = 256;
const DEFAULT_MAX_INPUT_LENGTH = 1_000_000;

export function parseFast(text: string, options: ParseOptions = {}): KodaValue {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxLen = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  if (text.length > maxLen) {
    throw new KodaParseError(`Input exceeds maximum length (${text.length} > ${maxLen})`, {
      position: { line: 1, column: 1, offset: 0 },
    });
  }
  const r = new Reader(text, maxDepth);
  const value = r.parseDocument();
  r.expectEof();
  return value;
}

class Reader {
  private pos = 0;
  private line = 1;
  private col = 1;
  private kind = K.Eof;
  private val: string | number | undefined = undefined;

  constructor(
    private readonly input: string,
    private readonly maxDepth: number
  ) {
    this.skipWs();
    this.readToken();
  }

  private get len(): number {
    return this.input.length;
  }
  private peek(): number {
    return this.pos >= this.len ? -1 : this.input.charCodeAt(this.pos);
  }
  private peekAhead(n: number): number {
    return this.pos + n >= this.len ? -1 : this.input.charCodeAt(this.pos + n);
  }
  private advance(): number {
    if (this.pos >= this.len) return -1;
    const c = this.input.charCodeAt(this.pos);
    this.pos++;
    if (c === 10) {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  private fail(msg: string): never {
    throw new KodaParseError(msg, { position: { line: this.line, column: this.col, offset: this.pos } });
  }

  private skipWs(): void {
    while (this.pos < this.len) {
      const c = this.peek();
      if (c === 32 || c === 9 || c === 13 || c === 10) {
        this.advance();
        continue;
      }
      if (c === 47 && this.peekAhead(1) === 47) {
        this.advance();
        this.advance();
        while (this.peek() !== -1 && this.peek() !== 10) this.advance();
        continue;
      }
      if (c === 47 && this.peekAhead(1) === 42) {
        this.advance();
        this.advance();
        let depth = 1;
        while (depth > 0 && this.pos + 1 < this.len) {
          const x = this.advance();
          if (x === 42 && this.peek() === 47) {
            this.advance();
            depth--;
          } else if (x === 47 && this.peek() === 42) {
            this.advance();
            depth++;
          }
        }
        if (depth !== 0) this.fail('Unclosed multi-line comment');
        continue;
      }
      return;
    }
  }

  private readToken(): void {
    this.skipWs();
    if (this.pos >= this.len) {
      this.kind = K.Eof;
      return;
    }
    const c = this.peek();
    if (c === 123) {
      this.advance();
      this.kind = K.LBrace;
      return;
    }
    if (c === 125) {
      this.advance();
      this.kind = K.RBrace;
      return;
    }
    if (c === 91) {
      this.advance();
      this.kind = K.LBracket;
      return;
    }
    if (c === 93) {
      this.advance();
      this.kind = K.RBracket;
      return;
    }
    if (c === 58) {
      this.advance();
      this.kind = K.Colon;
      return;
    }
    if (c === 44) {
      this.advance();
      this.kind = K.Comma;
      return;
    }
    if (c === 34 || c === 39) {
      this.val = this.readQuoted(c);
      this.kind = K.String;
      return;
    }
    if (c === 45 || (c >= 48 && c <= 57)) {
      const { val, isFloat } = this.readNumber();
      this.val = val;
      this.kind = isFloat ? K.Float : K.Integer;
      return;
    }
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95) {
      const raw = this.readIdentifier();
      if (raw === 'true') {
        this.kind = K.True;
        this.val = undefined;
      } else if (raw === 'false') {
        this.kind = K.False;
        this.val = undefined;
      } else if (raw === 'null') {
        this.kind = K.Null;
        this.val = undefined;
      } else {
        this.kind = K.Identifier;
        this.val = raw;
      }
      return;
    }
    this.fail('Unexpected character');
  }

  private readQuoted(quote: number): string {
    this.advance();
    const buf: string[] = [];
    while (this.pos < this.len) {
      const ch = this.advance();
      if (ch === quote) return buf.join('');
      if (ch === 92) {
        const next = this.advance();
        if (next === -1) this.fail('Unclosed string');
        if (next === quote) buf.push(String.fromCharCode(quote));
        else if (next === 92) buf.push('\\');
        else if (next === 47) buf.push('/');
        else if (next === 98) buf.push('\b');
        else if (next === 102) buf.push('\f');
        else if (next === 110) buf.push('\n');
        else if (next === 114) buf.push('\r');
        else if (next === 116) buf.push('\t');
        else if (next === 117) {
          let hex = '';
          for (let i = 0; i < 4; i++) {
            const h = this.advance();
            if (h === -1 || !((h >= 48 && h <= 57) || (h >= 97 && h <= 102) || (h >= 65 && h <= 70)))
              this.fail('Invalid \\u escape');
            hex += this.input.charAt(this.pos - 1);
          }
          buf.push(String.fromCodePoint(parseInt(hex, 16)));
        } else buf.push(String.fromCharCode(next));
      } else if (ch >= 0 && ch <= 31) {
        this.fail('Control character in string');
      } else {
        buf.push(String.fromCharCode(ch));
      }
    }
    this.fail('Unclosed string');
  }

  private readNumber(): { val: number; isFloat: boolean } {
    const start = this.pos;
    if (this.peek() === 45) this.advance();
    let isFloat = false;
    if (this.peek() === 48) {
      this.advance();
      const n = this.peek();
      if (n >= 49 && n <= 57) this.fail('Invalid number: leading zero');
      if (n === 46 || n === 101 || n === 69) isFloat = true;
    } else {
      while (this.peek() >= 48 && this.peek() <= 57) this.advance();
    }
    if (this.peek() === 46) {
      isFloat = true;
      this.advance();
      while (this.peek() >= 48 && this.peek() <= 57) this.advance();
    }
    if (this.peek() === 101 || this.peek() === 69) {
      isFloat = true;
      this.advance();
      if (this.peek() === 43 || this.peek() === 45) this.advance();
      while (this.peek() >= 48 && this.peek() <= 57) this.advance();
    }
    const raw = this.input.slice(start, this.pos);
    const num = isFloat ? parseFloat(raw) : parseInt(raw, 10);
    if (Number.isNaN(num)) this.fail('Invalid number');
    if (!isFloat && (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER))
      this.fail('Integer out of range');
    return { val: num, isFloat };
  }

  private readIdentifier(): string {
    const start = this.pos;
    while (this.pos < this.len) {
      const c = this.peek();
      if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 45) {
        this.advance();
      } else break;
    }
    return this.input.slice(start, this.pos);
  }

  expectEof(): void {
    if (this.kind !== K.Eof) this.fail('Expected end of input');
  }

  parseDocument(): KodaValue {
    const canBeKey = this.kind === K.Identifier || this.kind === K.String;
    if (canBeKey) {
      const saved = { pos: this.pos, kind: this.kind, val: this.val, line: this.line, col: this.col };
      this.readToken();
      const hasMore = this.kind !== K.Eof;
      this.pos = saved.pos;
      this.kind = saved.kind;
      this.val = saved.val;
      this.line = saved.line;
      this.col = saved.col;
      if (hasMore) return this.parseRootObject(0);
    }
    return this.parseValue(0);
  }

  private parseRootObject(depth: number): Record<string, KodaValue> {
    const obj: Record<string, KodaValue> = {};
    while (this.kind === K.Identifier || this.kind === K.String) {
      const key = this.val as string;
      this.readToken();
      if ((this.kind as number) === K.Colon) this.readToken();
      const value = this.parseValue(depth + 1);
      if (Object.prototype.hasOwnProperty.call(obj, key)) this.fail(`Duplicate key: ${JSON.stringify(key)}`);
      obj[key] = value;
    }
    return obj;
  }

  parseValue(depth: number): KodaValue {
    if (depth > this.maxDepth) this.fail(`Maximum nesting depth exceeded (${this.maxDepth})`);
    switch (this.kind) {
      case K.LBrace:
        return this.parseObject(depth);
      case K.LBracket:
        return this.parseArray(depth);
      case K.String:
      case K.Identifier: {
        const v = this.val as string;
        this.readToken();
        return v;
      }
      case K.Integer:
      case K.Float: {
        const v = this.val as number;
        this.readToken();
        return v;
      }
      case K.True:
        this.readToken();
        return true;
      case K.False:
        this.readToken();
        return false;
      case K.Null:
        this.readToken();
        return null;
      default:
        this.fail(`Unexpected token`);
    }
  }

  private parseObject(depth: number): Record<string, KodaValue> {
    this.readToken();
    const obj: Record<string, KodaValue> = {};
    while (this.kind !== K.RBrace) {
      if (this.kind !== K.Identifier && this.kind !== K.String) this.fail('Expected key');
      const key = this.val as string;
      this.readToken();
      if ((this.kind as number) === K.Colon) this.readToken();
      const value = this.parseValue(depth + 1);
      if (Object.prototype.hasOwnProperty.call(obj, key)) this.fail(`Duplicate key: ${JSON.stringify(key)}`);
      obj[key] = value;
      if ((this.kind as number) === K.Comma) this.readToken();
    }
    this.readToken();
    return obj;
  }

  private parseArray(depth: number): KodaValue[] {
    this.readToken();
    const arr: KodaValue[] = [];
    while (this.kind !== K.RBracket) {
      arr.push(this.parseValue(depth + 1));
      if ((this.kind as number) === K.Comma) this.readToken();
    }
    this.readToken();
    return arr;
  }
}
