/**
 * KODA parse/encode errors with line/column or byte offset.
 */

import type { SourcePosition } from './ast.js';

type ConstructorOptions = { position?: SourcePosition; byteOffset?: number; cause?: unknown };

export class KodaError extends Error {
  override readonly name: string = 'KodaError';
  readonly position?: SourcePosition;
  readonly byteOffset?: number;

  constructor(message: string, options?: ConstructorOptions) {
    super(message);
    this.position = options?.position;
    this.byteOffset = options?.byteOffset;
    if (options?.cause !== undefined) this.cause = options.cause;
    Object.setPrototypeOf(this, KodaError.prototype);
  }

  /** Human-readable location string */
  get location(): string {
    if (this.position) {
      return `line ${this.position.line}, column ${this.position.column}`;
    }
    if (this.byteOffset !== undefined) {
      return `byte offset ${this.byteOffset}`;
    }
    return '';
  }

  override toString(): string {
    const loc = this.location;
    return loc ? `${this.message} (${loc})` : this.message;
  }
}

export class KodaParseError extends KodaError {
  override readonly name = 'KodaParseError';
  constructor(message: string, options?: ConstructorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, KodaParseError.prototype);
  }
}

export class KodaEncodeError extends KodaError {
  override readonly name = 'KodaEncodeError';
  constructor(message: string, options?: ConstructorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, KodaEncodeError.prototype);
  }
}

export class KodaDecodeError extends KodaError {
  override readonly name = 'KodaDecodeError';
  constructor(message: string, options?: ConstructorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, KodaDecodeError.prototype);
  }
}
