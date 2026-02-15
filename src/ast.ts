/**
 * KODA Data Format — value types and positions.
 * All runtime values are immutable; types align with SPEC data model.
 */

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

/** KODA value types per SPEC §5 */
export type KodaValue =
  | KodaObject
  | KodaArray
  | string
  | number
  | boolean
  | null;

export interface KodaObject {
  [key: string]: KodaValue;
}

export type KodaArray = KodaValue[];

/** Type guard for object (and not array, which is also typeof 'object' in JSON) */
export function isKodaObject(v: KodaValue): v is KodaObject {
  return typeof v === 'object' && v !== null && Array.isArray(v) === false;
}

export function isKodaArray(v: KodaValue): v is KodaArray {
  return Array.isArray(v);
}

export function isKodaString(v: KodaValue): v is string {
  return typeof v === 'string';
}

export function isKodaNumber(v: KodaValue): v is number {
  return typeof v === 'number';
}

export function isKodaBoolean(v: KodaValue): v is boolean {
  return typeof v === 'boolean';
}

export function isKodaNull(v: KodaValue): v is null {
  return v === null;
}
