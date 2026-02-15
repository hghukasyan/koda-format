# KODA — Compact Object Data Architecture

**KODA** is a compact data format with a **text syntax** (`.koda`) and a **canonical binary encoding** (`.kod`). It is optimized for smaller payloads, efficient storage, and deterministic encoding—not for beating JSON on text parse speed. It wins on **size**, **IO**, and **storage** when using the binary format.

[![npm version](https://img.shields.io/npm/v/koda-format.svg)](https://www.npmjs.com/package/koda-format)  
**License:** MIT

---

## Quick start

```bash
npm install koda-format
```

```ts
import { parse, stringify, encode, decode } from 'koda-format';

// Text
const value = parse(`
  name: "my-app"
  version: 1
  enabled: true
`);
const back = stringify(value);

// Binary (canonical, smaller, good for storage)
const bytes = encode(value);
const decoded = decode(bytes);
```

---

## What’s in the box

| Feature | Description |
|--------|-------------|
| **Text (`.koda`)** | Objects, arrays, `key: value`, optional commas, `//` and `/* */` comments, unquoted identifiers. |
| **Binary (`.kod`)** | Magic + version, key dictionary (each key stored once), then typed data; big-endian; deterministic. |
| **Security** | Configurable max depth, max input length, max dictionary/string size. |
| **Optional C++ addon** | Faster encode/decode when built; same API, pure JS fallback. |

Full grammar and binary layout: **[SPEC.md](./SPEC.md)**.

---

## API

| Function | Description |
|----------|-------------|
| `parse(text, options?)` | Parse KODA text → value. Options: `maxDepth`, `maxInputLength`. |
| `stringify(value, options?)` | Value → KODA text. Options: `indent`, `newline`. |
| `encode(value, options?)` | Value → canonical binary `Uint8Array`. Options: `maxDepth`. |
| `decode(buffer, options?)` | Binary → value. Options: `maxDepth`, `maxDictionarySize`, `maxStringLength`. |
| `loadFile(path, options?)` | Read file (UTF-8) and parse. |
| `saveFile(path, value, options?)` | Stringify and write file. |
| `toJSON(value)` | Same as `JSON.stringify(value)`. |
| `fromJSON(json)` | Same as `JSON.parse(json)`. |
| `parseWithLexer(text, options?)` | Lexer-based parse (better error positions). |
| `isNativeAvailable()` | `true` if the C++ addon is loaded. |

Errors: `KodaParseError`, `KodaEncodeError`, `KodaDecodeError` (with `.position` or `.byteOffset`).

---

## Binary format (implemented)

- **Magic:** 4 bytes `KODA` (0x4B 0x4F 0x44 0x41).  
- **Version:** 1 byte (`1`).  
- **Dictionary:** N unique keys (UTF-8), canonical order; each key: 4 bytes length (BE) + bytes.  
- **Data:** Root value with type tags: null, false, true, int64, float64, string, array, object. Objects use key indices into the dictionary. Same value → same bytes.

---

## Storage (e.g. PostgreSQL BYTEA)

```ts
const bytes = encode(document);
// store in BYTEA; later:
const value = decode(row.bytes);
```

---

## Build C++ addon (optional)

Requires Node.js build tools and a C++ compiler:

```bash
npm run build:addon
# or
npm run build:all
```

---

## Repo

- **[SPEC.md](./SPEC.md)** — Grammar, data model, binary layout, canonicalization, security.
- **Source:** `src/` (TypeScript). **Native:** `native/` (C++ N-API). **Tests:** `test/`. **Examples:** `examples/*.koda`.

---

**KODA** — Compact Object Data Architecture. MIT.
