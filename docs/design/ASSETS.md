# Third-party design assets and libraries

The founder's header rules (`visual-language.md`) require us to record every third-party motion library, font, and
downloaded asset that ships on cryoshield.app, with its source and license. Everything listed here is served from
`'self'`, and no runtime CDN is used. `apps/web/test/build/assets.test.ts` checks this file against the repository.

| Item | Version | Source | License | Where it is used |
|---|---|---|---|---|
| Motion (`motion`, with its dependencies `motion-dom`, `motion-utils`, `framer-motion`, `tslib`) | `motion@13.5.0` (exact pin; lockfile integrity in `pnpm-lock.yaml`) | https://www.npmjs.com/package/motion · https://github.com/motiondivision/motion | MIT (`tslib`: 0BSD) | Landing page only (`apps/web/src/landing/motion.ts`), lazy-loaded. Only `animate` from `motion/mini` (WAAPI) and `scroll` / `inView` are imported. |
| Inter, variable weight, latin subset (`inter-latin-wght-normal.woff2`) | from `@fontsource-variable/inter@5.3.0` | https://www.npmjs.com/package/@fontsource-variable/inter · upstream https://github.com/rsms/inter | SIL Open Font License 1.1 (full text in `apps/web/src/ui/fonts/OFL.txt`) | `apps/web/src/ui/fonts/`, the font fallback after the system UI stack, on both pages |

## Integrity

- `inter-latin-wght-normal.woff2` is byte-for-byte the npm package's `files/inter-latin-wght-normal.woff2`:
  - SHA-256: `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`;
  - size: 48,256 bytes.
- Motion is installed by pnpm from the lockfile (integrity hashes) with install scripts disabled repo-wide.

## CSP compatibility checks (2026-10-02)

- **Motion:** we grepped the ESM dists of `motion`, `motion-dom`, `motion-utils` and `framer-motion` for `innerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval(`, `new Function` and `WebAssembly`, and found none. Motion writes
  styles through the CSSOM, which `style-src 'self'` does not restrict.
- **Fonts:** fonts load under `font-src 'self'` from `/assets/` (content-hashed by Vite).

## Considered and rejected

- **GSAP:** its "Standard no-charge" license is not an OSI open-source license.
- **lottie-web / dotLottie:**
  - expressions use `eval`/`new Function`;
  - the dotLottie player needs WASM;
  - third-party animation JSON has mixed licensing.
- **Downloaded animation assets:** none are used. Every landing graphic is a first-party SVG drawn for CryoShield.
- **SF Pro and other Apple fonts:** never bundled (license, and the founder's rule).
