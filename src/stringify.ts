/**
 * KODA value to text (.koda). Produces compact, human-readable output.
 * Keys that are valid identifiers are emitted unquoted; strings quoted when necessary.
 */

import type { KodaValue } from './ast.js';

export interface StringifyOptions {
  /** Indent string for pretty-print (default: no indent, single line) */
  indent?: string;
  /** Newline (default "\n") */
  newline?: string;
}

function needsQuote(s: string): boolean {
  if (s.length === 0) return true;
  const first = s[0]!;
  if (!/[\w_]/.test(first) && first !== '_') return true;
  for (let i = 1; i < s.length; i++) {
    if (!/[\w\-_]/.test(s[i]!)) return true;
  }
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === 'false' || lower === 'null') return true;
  return false;
}

function escapeDouble(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\b/g, '\\b')
    .replace(/\f/g, '\\f')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function quoteKey(key: string): string {
  if (needsQuote(key)) return `"${escapeDouble(key)}"`;
  return key;
}

function quoteValueString(s: string): string {
  if (needsQuote(s)) return `"${escapeDouble(s)}"`;
  return s;
}

function writeNumber(n: number): string {
  if (Number.isInteger(n) && n >= Number.MIN_SAFE_INTEGER && n <= Number.MAX_SAFE_INTEGER) {
    return String(n);
  }
  return JSON.stringify(n);
}

function stringifyValue(
  value: KodaValue,
  indent: string,
  newline: string,
  level: number
): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return writeNumber(value);
  if (typeof value === 'string') return quoteValueString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const nextPrefix = indent.repeat(level + 1);
    const sep = indent ? newline + nextPrefix : ' ';
    const inner = value
      .map((v) => stringifyValue(v, indent, newline, level + 1))
      .join(sep);
    return `[${sep}${inner} ]`;
  }
  const obj = value as Record<string, KodaValue>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  const nextPrefix = indent.repeat(level + 1);
  const sep = indent ? newline + nextPrefix : ' ';
  const pairs = keys.map((k) => {
    const keyPart = quoteKey(k) + ':';
    const valuePart = stringifyValue(obj[k]!, indent, newline, level + 1);
    return `${keyPart} ${valuePart}`;
  });
  return `{${sep}${pairs.join(sep)} }`;
}

/**
 * Serialize a KODA value to text format.
 */
export function stringify(value: KodaValue, options: StringifyOptions = {}): string {
  const indent = options.indent ?? '';
  const newline = options.newline ?? '\n';
  return stringifyValue(value, indent, newline, 0).trim();
}
