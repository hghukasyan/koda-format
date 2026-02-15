/**
 * KODA text format parser. Builds KodaValue from tokens with depth and size limits.
 * See SPEC §4 (Text Syntax), §8 (Error handling), §9 (Security).
 */

import type { KodaValue } from './ast.js';
import { KodaParseError } from './errors.js';
import { TokenKind, type Token } from './lexer.js';
import { tokenize } from './lexer.js';

export interface ParseOptions {
  /** Max nesting depth (default 256). SPEC §9. */
  maxDepth?: number;
  /** Max input length in characters. Passed to lexer. */
  maxInputLength?: number;
}

const DEFAULT_MAX_DEPTH = 256;

export function parse(text: string, options: ParseOptions = {}): KodaValue {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const tokens = tokenize(text, {
    maxInputLength: options.maxInputLength,
  });
  const p = new Parser(tokens, maxDepth);
  const value = p.parseDocument();
  p.expect(TokenKind.Eof);
  return value;
}

class Parser {
  private index = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly maxDepth: number
  ) {}

  private get current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private at(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }

  private advance(): Token {
    const t = this.current;
    if (this.index < this.tokens.length - 1) this.index++;
    return t;
  }

  expect(kind: TokenKind): Token {
    if (this.current.kind !== kind) {
      throw new KodaParseError(
        `Expected ${kind}, got ${this.current.kind}`,
        { position: this.current.start }
      );
    }
    return this.advance();
  }

  private fail(message: string): never {
    throw new KodaParseError(message, { position: this.current.start });
  }

  /** Root: implicit object (key value ...) or single value. */
  parseDocument(): KodaValue {
    const canBeKey = this.at(TokenKind.Identifier) || this.at(TokenKind.String);
    const hasMore = this.index + 1 < this.tokens.length && this.tokens[this.index + 1]!.kind !== TokenKind.Eof;
    if (canBeKey && hasMore) {
      return this.parseRootObject(0);
    }
    return this.parseValue(0);
  }

  /** Parse root-level key value key value ... into an object (no surrounding braces). */
  private parseRootObject(depth: number): Record<string, KodaValue> {
    const obj: Record<string, KodaValue> = {};
    while (this.at(TokenKind.Identifier) || this.at(TokenKind.String)) {
      const keyToken = this.current;
      const key = this.advance().value as string;
      if (this.at(TokenKind.Colon)) this.advance();
      const value = this.parseValue(depth + 1);
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        throw new KodaParseError(`Duplicate key: ${JSON.stringify(key)}`, { position: keyToken.start });
      }
      obj[key] = value;
    }
    return obj;
  }

  parseValue(depth: number): KodaValue {
    if (depth > this.maxDepth) {
      throw new KodaParseError(
        `Maximum nesting depth exceeded (${this.maxDepth})`,
        { position: this.current.start }
      );
    }

    switch (this.current.kind) {
      case TokenKind.LBrace:
        return this.parseObject(depth);
      case TokenKind.LBracket:
        return this.parseArray(depth);
      case TokenKind.String:
        return this.advance().value as string;
      case TokenKind.Identifier:
        return this.advance().value as string;
      case TokenKind.Integer:
        return this.advance().value as number;
      case TokenKind.Float:
        return this.advance().value as number;
      case TokenKind.True:
        this.advance();
        return true;
      case TokenKind.False:
        this.advance();
        return false;
      case TokenKind.Null:
        this.advance();
        return null;
      default:
        this.fail(`Unexpected token: ${this.current.kind}`);
    }
  }

  private parseObject(depth: number): Record<string, KodaValue> {
    this.expect(TokenKind.LBrace);
    const obj: Record<string, KodaValue> = {};
    while (!this.at(TokenKind.RBrace)) {
      const keyToken = this.current;
      let key: string;
      if (keyToken.kind === TokenKind.Identifier) {
        key = this.advance().value as string;
      } else if (keyToken.kind === TokenKind.String) {
        key = this.advance().value as string;
      } else {
        this.fail('Expected key (identifier or string)');
      }
      if (this.at(TokenKind.Colon)) this.advance();
      const value = this.parseValue(depth + 1);
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        throw new KodaParseError(`Duplicate key: ${JSON.stringify(key)}`, {
          position: keyToken.start,
        });
      }
      obj[key] = value;
      // Optional comma or more key-value pairs
      if (this.at(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RBrace);
    return obj;
  }

  private parseArray(depth: number): KodaValue[] {
    this.expect(TokenKind.LBracket);
    const arr: KodaValue[] = [];
    while (!this.at(TokenKind.RBracket)) {
      arr.push(this.parseValue(depth + 1));
      if (this.at(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RBracket);
    return arr;
  }
}
