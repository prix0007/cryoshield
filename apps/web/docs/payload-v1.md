# CryoShield vault payload encoding v1

> **Superseded for decoders by [`docs/spec/payload-v2.md`](../../../docs/spec/payload-v2.md)** (change
> `vault-list-labels-archive`). v2 decoders read v1 and v2. Writers still emit these v1 bytes for an unnamed,
> active vault with at least one item (minimal-version rule). v1 decoding is now strict and canonical: the
> "must not depend on key order or whitespace" rule below is withdrawn. The examples below are vectors
> `v1-single`, `v1-multi` and `v1-unicode` in [`docs/spec/payload-vectors.json`](../../../docs/spec/payload-vectors.json).

This document is normative for every CryoShield client (web app, desktop recovery tool). It defines the bytes that
`@cryoshield/vault-crypto` encrypts as the vault *secret*. The vault blob format itself is defined in
`docs/spec/vault-format-v1.md`; this layer sits inside the encrypted payload.

## Encoding

The plaintext is a UTF-8 JSON document with exactly these fields, in this order, with no whitespace:

```
{"v":1,"items":[{"l":<label>,"s":<secret>}, ...]}
```

- `v`: the number `1`.
- `items`: a non-empty array, in the order the user entered them.
  - `l`: label, a string of 0 to 64 Unicode code points (for example "Bitcoin seed").
  - `s`: secret, a string (newlines allowed).
- No other fields at any level.
- Encoders emit compact JSON (`JSON.stringify` with no spacing). Non-ASCII characters are written as UTF-8,
  not `\u` escapes; control characters use standard JSON escapes.

## Decoding

- Invalid UTF-8, invalid JSON, a missing or extra field, an empty `items`, a non-string `l`/`s`, or a label over
  64 code points: **malformed** (show nothing).
- `v` is a number other than 1: **unknown version**. Show "This vault was made by a newer version of
  CryoShield" and display nothing.
- Decoders must not depend on key order or whitespace, but must reject extra fields.

## Size

The encoded bytes must fit `maxPayloadBytes(rpId, credentialIds, mode)` from `@cryoshield/vault-crypto`
(about 638 bytes with 2 keys and 64-byte credential IDs). Each item costs `"l":"" "s":""` plus `{},` overhead,
about 15 bytes plus its text.

## Examples

Each example is the exact plaintext; the hex is its UTF-8 encoding. The web app's unit tests check these bytes.

<!-- example:single -->
```json
{"v":1,"items":[{"l":"Bitcoin seed","s":"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"}]}
```

Hex: `7b2276223a312c226974656d73223a5b7b226c223a22426974636f696e2073656564222c2273223a226162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e206162616e646f6e2061626f7574227d5d7d`

<!-- example:multi -->
```json
{"v":1,"items":[{"l":"GitHub recovery codes","s":"1a2b3-c4d5e\n6f7g8-h9i0j"},{"l":"Email 2FA","s":"JBSWY3DPEHPK3PXP"}]}
```

Hex: `7b2276223a312c226974656d73223a5b7b226c223a22476974487562207265636f7665727920636f646573222c2273223a2231613262332d63346435655c6e36663767382d683969306a227d2c7b226c223a22456d61696c20324641222c2273223a224a425357593344504548504b33505850227d5d7d`

<!-- example:unicode -->
```json
{"v":1,"items":[{"l":"Notizen ✓","s":"Passwort: grün-Ü"}]}
```

Hex: `7b2276223a312c226974656d73223a5b7b226c223a224e6f74697a656e20e29c93222c2273223a2250617373776f72743a206772c3bc6e2dc39c227d5d7d`

