<!-- MIRROR of FlightDeck OS flightdeck/pagedoc/README.md at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one. -->
# PageDoc portable tree (`flightdeck/pagedoc/`)

The one rich-content model and renderer for OS pages, Atlas pages and app intros
(plan `docs/PLAN-2026-09-25-ONBOARDING-APPS-PAGES-CRM.md`, Lane C). This tree is
copied **byte for byte** into Flightdeck Atlas `lib/pagedoc`, the way Atlas
`lib/motion` mirrors `web/src/motion`. So nothing in it may depend on the OS.

| Path | Holds |
|---|---|
| `schema/` | The zod (`zod/v4`) PageDoc v2 schema: envelope, localized text, rich text, sections/columns, the core blocks (hero, richText, divider) in `blocksCore.ts`, the content blocks (media, gallery, featureGrid, benefits, faq, cta, appCards, widget, tabs) and the closed block union in `blocksContent.ts`, `limits.ts`, the pure `turnInto` block conversions in `turnInto.ts`, and `parsePageDoc` / `migratePageDoc` / `reissueIds` in `index.ts`. The only way to read a doc is `parsePageDoc`. |
| `render/` | The in-house React renderer (`createElement`, no JSX, so it also compiles in the server's typecheck stack): `PageDocRenderer` ({doc, locale, adapters, editing?, theme?, onBlockError?}), `Section` (sections and columns), `richText.ts`, `BlockBoundary` (per-block isolation), `blocks/` (hero, richText, divider, and the content blocks: media, gallery, featureGrid, benefits, faq, cta, appCards, widget, tabs), `context.ts` (`pickLocalized`: requested locale, then the other, then the source; fallback text carries its real `lang` and `data-missing-translation`; the renderer's built-in EN/DE words). Media is never loaded by an address: the host's `media.resolve` fetches it (D-034) and reports loading, ready, missing or forbidden, below-the-fold media (all but the hero image, and video posters) is resolved only once an IntersectionObserver sees it near the viewport (never in a server render, never in a hidden tab), and a video resolves nothing but its poster before Play. Tabs follow the WAI-ARIA tabs pattern (roving tabindex). Only `pd-*` classes; the host owns landmarks and the page's h1. |
| `adapters.ts` | The host adapter contract (v3: `media.resolve`, `resolvePage`, `navigate`, `widget`, `appState` with six states, `appAction`, `appCard`, `visibleApps`) and its version. |
| `pagedoc.css` | The renderer's stylesheet, scoped to `.pd-root`: structure only; its header lists the `--pd-*` colour properties each host maps. |
| `fixtures/` | Conformance inputs both hosts test against (`DOC_FIXTURES`: accepted and refused docs, including every block family alone, template shapes, max-size, language, stale-translation, hostile-text and max-nesting cases), and golden HTML `<name>.<locale>.html` for every accepted fixture (`golden.ts` holds the normalisation and `goldenAdapters()`, the fixed adapters goldens are rendered with; regenerate with `UPDATE_PAGEDOC_GOLDENS=1 npx vitest run tests/pagedocRender.test.tsx`). |

## The portability rules

`node scripts/check-pagedoc-portable.mjs` (run by `tests/pagedocPortable.test.ts`,
so `npm test` enforces it) fails when a source file here:

- imports a path that leaves this tree;
- imports any package other than `react`, `react-dom` (and their subpaths) or
  `zod/v4` (both hosts ship `zod/v4`: the OS has zod 4, Atlas zod 3.25);
- uses raw HTML injection or string evaluation (`dangerouslySetInnerHTML`,
  `innerHTML`, `eval(`, `new Function`);
- names a CSS custom property that does not start with `--pd-`. Each host maps
  `--pd-*` to its own tokens in its own stylesheet.

Relative imports carry a `.js` extension, so the tree compiles under both the
server's NodeNext resolution and the web bundler resolution.

## The mirror release contract (`MANIFEST.json`)

`MANIFEST.json` lists every file in this tree (except itself) with the sha256
of its bytes, plus the schema versions the tree reads (`schemaVersions`, from
`PAGEDOC_READABLE_VERSIONS`), the host adapter contract version
(`adapterContract`, from `PAGEDOC_ADAPTER_CONTRACT_VERSION`) and the OS commit it
was generated on (`osCommit`, informational only).

- **Regenerate** after any edit here: `npm run pagedoc:manifest`
  (`scripts/pagedoc-manifest.mjs`). `npm run check:pagedoc` and
  `tests/pagedocManifest.test.ts` fail while the manifest is stale: a changed,
  added or removed file, or a changed version.
- **Atlas vendors `MANIFEST.json`** with its copy in `lib/pagedoc`, and Atlas CI
  checks its own copies against the vendored manifest's sha256 values. It needs
  no sibling OS checkout.
- **Release order:** the Atlas mirror ships first. Only after Atlas can read a new
  schema version may the OS emit it.
- **Version negotiation:** the Atlas feed request sends an
  `Accept-Pagedoc-Versions` header listing the versions it reads. The OS never
  sends Atlas a version it cannot parse. For such a page it returns a
  "needs update" stub instead.
- **Downgrade:** the OS only writes schema versions it can read back
  (`PAGEDOC_SCHEMA_VERSION` is always in `PAGEDOC_READABLE_VERSIONS`), so rolling
  the OS back never strands a document it wrote.
