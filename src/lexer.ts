/**
 * KODA text format lexer. Produces tokens with source positions.
 * See SPEC §4 (Text Syntax).
 */

import type { SourcePosition } from './ast.js';
import { KodaParseError } from './errors.js';

export const enum TokenKind {
  LBrace = 'LBrace',
  RBrace = 'RBrace',
  LBracket = 'LBracket',
  RBracket = 'RBracket',
  Colon = 'Colon',
  Comma = 'Comma',
  String = 'String',
  Identifier = 'Identifier',
  Integer = 'Integer',
  Float = 'Float',
  True = 'True',
  False = 'False',
  Null = 'Null',
  Eof = 'Eof',
}

export interface Token {
  kind: TokenKind;
  value?: string | number;
  start: SourcePosition;
  end: SourcePosition;
}

function pos(line: number, column: number, offset: number): SourcePosition {
  return { line, column, offset };
}

export interface LexerOptions {
  /** Max input length in characters (default 1_000_000) */
  maxInputLength?: number;
}

const DEFAULT_MAX_INPUT_LENGTH = 1_000_000;

export function tokenize(
  input: string,
  options: LexerOptions = {}
): Token[] {
  const maxLen = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  if (input.length > maxLen) {
    throw new KodaParseError(
      `Input exceeds maximum length (${input.length} > ${maxLen})`,
      { position: pos(1, 1, 0) }
    );
  }

  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;

  function advance(): string | undefined {
    if (offset >= input.length) return undefined;
    const c = input[offset];
    offset++;
    if (c === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
    return c;
  }

  function peek(): string | undefined {
    return input[offset];
  }

  function peekAhead(n: number): string | undefined {
    return input[offset + n];
  }

  function makeStart(): SourcePosition {
    return pos(line, column, offset);
  }

  function emit(kind: TokenKind, value?: string | number): void {
    const start = makeStart();
    tokens.push({ kind, value, start, end: pos(line, column, offset) });
  }

  function fail(message: string): never {
    throw new KodaParseError(message, { position: makeStart() });
  }

  function skipWhitespaceAndComments(): void {
    for (;;) {
      const c = peek();
      if (c === undefined) return;
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        advance();
        continue;
      }
      if (c === '/' && peekAhead(1) === '/') {
        advance();
        advance();
        while (peek() !== undefined && peek() !== '\n') advance();
        continue;
      }
      if (c === '/' && peekAhead(1) === '*') {
        advance();
        advance();
        let depth = 1;
        while (depth > 0) {
          const x = advance();
          if (x === undefined) fail('Unclosed multi-line comment');
          if (x === '*' && peek() === '/') {
            advance();
            depth--;
          } else if (x === '/' && peek() === '*') {
            advance();
            depth++;
          }
        }
        continue;
      }
      return;
    }
  }

  function readQuotedString(quote: '"' | "'"): string {
    const start = makeStart();
    advance(); // consume opening quote
    const buf: string[] = [];
    for (;;) {
      const c = advance();
      if (c === undefined) fail('Unclosed string');
      if (c === quote) break;
      if (c === '\\') {
        const next = advance();
        if (next === undefined) fail('Unclosed string');
        if (next === quote) buf.push(quote);
        else if (next === '\\') buf.push('\\');
        else if (next === '/') buf.push('/');
        else if (next === 'b') buf.push('\b');
        else if (next === 'f') buf.push('\f');
        else if (next === 'n') buf.push('\n');
        else if (next === 'r') buf.push('\r');
        else if (next === 't') buf.push('\t');
        else if (next === 'u') {
          let hex = '';
          for (let i = 0; i < 4; i++) {
            const h = advance();
            if (h === undefined) fail('Incomplete \\u escape');
            if (!/[\da-fA-F]/.test(h)) fail('Invalid \\u escape');
            hex += h;
          }
          buf.push(String.fromCodePoint(parseInt(hex, 16)));
        } else fail(`Invalid escape sequence \\${next}`);
      } else if (c >= '\x00' && c <= '\x1f') {
        fail('Control character in string');
      } else {
        buf.push(c);
      }
    }
    tokens.push({
      kind: TokenKind.String,
      value: buf.join(''),
      start,
      end: makeStart(),
    });
    return buf.join('');
  }

  function readIdentifierOrKeyword(): void {
    const start = makeStart();
    const buf: string[] = [];
    const first = advance();
    if (first === undefined || (!/[\w_]/.test(first) && first !== '_')) {
      fail('Expected identifier or keyword');
    }
    buf.push(first);
    for (;;) {
      const c = peek();
      if (c === undefined) break;
      if (!/[\w\-_]/.test(c)) break;
      buf.push(advance()!);
    }
    const raw = buf.join('');
    if (raw === 'true') {
      tokens.push({ kind: TokenKind.True, start, end: makeStart() });
      return;
    }
    if (raw === 'false') {
      tokens.push({ kind: TokenKind.False, start, end: makeStart() });
      return;
    }
    if (raw === 'null') {
      tokens.push({ kind: TokenKind.Null, start, end: makeStart() });
      return;
    }
    tokens.push({ kind: TokenKind.Identifier, value: raw, start, end: makeStart() });
  }

  function readNumber(): void {
    const start = makeStart();
    const buf: string[] = [];
    let c = peek();
    if (c === '-') {
      buf.push(advance()!);
      c = peek();
    }
    if (c === '0') {
      buf.push(advance()!);
      c = peek();
      if (c !== undefined && /[.eE]/.test(c)) {
        // float 0.xxx or 0e0 — fall through
      } else if (c !== undefined && c >= '1' && c <= '9') {
        fail('Invalid number: leading zero');
      } else {
        tokens.push({ kind: TokenKind.Integer, value: 0, start, end: makeStart() });
        return;
      }
    } else if (c !== undefined && c >= '1' && c <= '9') {
      while (c !== undefined && /[0-9]/.test(c)) {
        buf.push(advance()!);
        c = peek();
      }
    } else if (c === '.') {
      buf.push(advance()!);
      c = peek();
      if (c === undefined || !/[0-9]/.test(c)) fail('Invalid number: expected digits after .');
      while (c !== undefined && /[0-9]/.test(c)) {
        buf.push(advance()!);
        c = peek();
      }
      const n = parseFloat(buf.join(''));
      if (Number.isNaN(n)) fail('Invalid float');
      tokens.push({ kind: TokenKind.Float, value: n, start, end: makeStart() });
      return;
    } else {
      fail('Invalid number');
    }
    c = peek();
    let isFloat = false;
    if (c === '.') {
      isFloat = true;
      buf.push(advance()!);
      c = peek();
      if (c !== undefined && /[0-9]/.test(c)) {
        while (c !== undefined && /[0-9]/.test(c)) {
          buf.push(advance()!);
          c = peek();
        }
      }
    }
    c = peek();
    if (c === 'e' || c === 'E') {
      isFloat = true;
      buf.push(advance()!);
      c = peek();
      if (c === '+' || c === '-') buf.push(advance()!);
      c = peek();
      if (c === undefined || !/[0-9]/.test(c)) fail('Invalid exponent');
      while (c !== undefined && /[0-9]/.test(c)) {
        buf.push(advance()!);
        c = peek();
      }
    }
    const raw = buf.join('');
    if (isFloat) {
      const n = parseFloat(raw);
      if (Number.isNaN(n)) fail('Invalid float');
      tokens.push({ kind: TokenKind.Float, value: n, start, end: makeStart() });
    } else {
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || n > Number.MAX_SAFE_INTEGER || n < Number.MIN_SAFE_INTEGER) {
        fail('Integer out of range');
      }
      tokens.push({ kind: TokenKind.Integer, value: n, start, end: makeStart() });
    }
  }

  while (offset <= input.length) {
    skipWhitespaceAndComments();
    if (offset >= input.length) break;

    const c = peek();
    if (c === '{') {
      advance();
      emit(TokenKind.LBrace);
      continue;
    }
    if (c === '}') {
      advance();
      emit(TokenKind.RBrace);
      continue;
    }
    if (c === '[') {
      advance();
      emit(TokenKind.LBracket);
      continue;
    }
    if (c === ']') {
      advance();
      emit(TokenKind.RBracket);
      continue;
    }
    if (c === ':') {
      advance();
      emit(TokenKind.Colon);
      continue;
    }
    if (c === ',') {
      advance();
      emit(TokenKind.Comma);
      continue;
    }
    if (c === '"' || c === "'") {
      readQuotedString(c as '"' | "'");
      continue;
    }
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) {
      readNumber();
      continue;
    }
    if (c !== undefined && /[a-zA-Z_]/.test(c)) {
      readIdentifierOrKeyword();
      continue;
    }
    fail(`Unexpected character: ${JSON.stringify(c)}`);
  }

  tokens.push({
    kind: TokenKind.Eof,
    start: pos(line, column, offset),
    end: pos(line, column, offset),
  });
  return tokens;
}
