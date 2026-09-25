// MIRROR of FlightDeck OS flightdeck/pagedoc/fixtures/index.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Shared conformance fixtures. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so both hosts test against the same inputs.
// Golden-HTML fixtures arrive with the renderer slices. Template-shaped
// fixtures carry neutral placeholder words only: they are test inputs, not
// starter content (starters are human-owned and ship empty until approved).

/** `schemaVersion` values and whether this tree must read them. */
export const VERSION_FIXTURES: ReadonlyArray<{ value: unknown; readable: boolean }> = [
  { value: 2, readable: true },
  { value: 1, readable: false },
  { value: 3, readable: false },
  { value: "2", readable: false },
];

export type DocFixtureExpect = "ok" | "invalid" | "too_new" | "too_old";

export interface DocFixture {
  name: string;
  doc: unknown;
  expect: DocFixtureExpect;
  /** The PageDocIssue code the refusal must include, when one is pinned. */
  issue?: string;
}

// Ids are deterministic so the fixtures are byte-stable across hosts.
const id = (prefix: string, n: number) => `${prefix}${String(n).padStart(10 - prefix.length, "0")}`;

const meta = (over: Record<string, unknown> = {}) => ({
  sourceLocale: "en",
  title: { en: "Welcome", de: "Willkommen" },
  ...over,
});

const section = (n: number, layout: string, columns: unknown[][], over: Record<string, unknown> = {}) => ({
  id: id("s", n),
  layout,
  emphasis: "none",
  spacing: "normal",
  phone: "stack",
  columns: columns.map((blocks, i) => ({ id: id(`c${n}x`, i), blocks })),
  ...over,
});

const doc = (sections: unknown[], over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  meta: meta(),
  sections,
  ...over,
});

const hero = (n: number) => ({
  id: id("h", n),
  type: "hero",
  heading: { en: "Hello", de: "Hallo" },
  subheading: { en: "Start here" },
});

const divider = (n: number) => ({ id: id("d", n), type: "divider" });

const paragraph = (n: number, text: string, marks?: unknown[]) => ({
  id: id("p", n),
  type: "richText",
  content: { en: [{ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] }] },
});

const link = (n: number, href: string) => paragraph(n, "link", [{ type: "link", href }]);

/** A media library id: 24 lower-case letters or digits. */
const mid = (n: number) => `med${String(n).padStart(21, "0")}`;
const PAGE_ID = "3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b";
const SHA1 = "0123456789abcdef0123456789abcdef01234567";

const heroWithButton = (n: number) => ({
  ...hero(n),
  media: { mediaId: mid(n), alt: { en: "Placeholder image", de: "Platzhalterbild" } },
  cta: { label: { en: "Open", de: "Öffnen" }, style: "primary", action: { type: "openApp", appId: "contracts" } },
});

const media = (n: number, over: Record<string, unknown> = {}) => ({
  id: id("m", n),
  type: "media",
  kind: "image",
  mediaRef: { mediaId: mid(n) },
  alt: { en: "Placeholder image", de: "Platzhalterbild" },
  caption: { en: "Caption", de: "Bildunterschrift" },
  focal: { x: 0.5, y: 0.25 },
  ...over,
});

const video = (n: number) => {
  const { focal: _focal, ...rest } = media(n, { kind: "video" });
  return {
    ...rest,
    posterRef: { mediaId: mid(900 + n) },
    captions: { en: { mediaId: mid(950 + n) }, de: { mediaId: mid(960 + n) } },
  };
};

const gallery = (n: number, count: number, over: (i: number) => Record<string, unknown> = () => ({})) => ({
  id: id("g", n),
  type: "gallery",
  items: Array.from({ length: count }, (_, i) => ({
    id: id(`gi${n}x`, i),
    mediaRef: { mediaId: mid(100 + i) },
    alt: { en: `Image ${i + 1}` },
    ...(i % 2 === 0 ? { caption: { en: `Caption ${i + 1}`, de: `Unterschrift ${i + 1}` } } : {}),
    ...over(i),
  })),
});

const featureGrid = (n: number, count: number) => ({
  id: id("f", n),
  type: "featureGrid",
  heading: { en: "Features", de: "Funktionen" },
  items: Array.from({ length: count }, (_, i) => ({
    id: id(`fi${n}x`, i),
    title: { en: `Feature ${i + 1}`, de: `Funktion ${i + 1}` },
    text: { en: "Placeholder text" },
    ...(i === 0 ? { media: { mediaId: mid(200 + i), decorative: true } } : {}),
  })),
});

const benefits = (n: number, count: number) => ({
  id: id("b", n),
  type: "benefits",
  heading: { en: "Benefits", de: "Vorteile" },
  items: Array.from({ length: count }, (_, i) => ({
    id: id(`bi${n}x`, i),
    title: { en: `Benefit ${i + 1}`, de: `Vorteil ${i + 1}` },
    ...(i % 2 === 0 ? { text: { de: "Platzhaltertext" } } : {}),
  })),
});

const faq = (n: number, count: number) => ({
  id: id("q", n),
  type: "faq",
  heading: { en: "Questions" },
  items: Array.from({ length: count }, (_, i) => ({
    id: id(`qi${n}x`, i),
    q: { en: `Question ${i + 1}?`, de: `Frage ${i + 1}?` },
    a: {
      en: [{ type: "paragraph", content: [{ type: "text", text: "Answer", marks: [{ type: "bold" }] }] }],
      de: [{ type: "paragraph", content: [{ type: "text", text: "Antwort" }] }],
    },
  })),
});

const cta = (n: number, action: unknown, over: Record<string, unknown> = {}) => ({
  id: id("a", n),
  type: "cta",
  heading: { en: "Ready?", de: "Bereit?" },
  text: { en: "Placeholder text" },
  label: { en: "Continue", de: "Weiter" },
  style: "primary",
  action,
  ...over,
});

const appCards = (n: number, over: Record<string, unknown> = { appIds: ["contracts", "knowledge-guardian"] }) => ({
  id: id("ac", n),
  type: "appCards",
  heading: { en: "Apps" },
  ...over,
});

const widget = (n: number, keys = 2) => ({
  id: id("w", n),
  type: "widget",
  widgetId: "kpi-open-tickets",
  config: Object.fromEntries(
    Array.from({ length: keys }, (_, i) => [`key${i}`, i % 3 === 0 ? `v${i}` : i % 3 === 1 ? i : i % 2 === 0]),
  ),
});

const tabs = (n: number, count: number, blocksFor: (i: number) => unknown[] = () => []) => ({
  id: id("tb", n),
  type: "tabs",
  tabs: Array.from({ length: count }, (_, i) => ({
    id: id(`tt${n}x`, i),
    label: { en: `Tab ${i + 1}`, de: `Reiter ${i + 1}` },
    blocks: blocksFor(i),
  })),
});

/** A JSON round trip drops the `undefined` values the builders use to omit a key. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const alone = (block: unknown) => () => ({ doc: doc([section(1, "1", [[plain(block)]])]), expect: "ok" as const });
const refused = (block: unknown, issue?: string) => () => ({
  doc: doc([section(1, "1", [[plain(block)]])]),
  expect: "invalid" as const,
  ...(issue ? { issue } : {}),
});

/** section > column > block(tabs) > tab > block(tabs) > tab: six levels. */
const deepTabs = {
  id: id("t", 1),
  type: "tabs",
  tabs: [
    {
      id: id("t", 2),
      label: { en: "One" },
      blocks: [{ id: id("t", 3), type: "tabs", tabs: [{ id: id("t", 4), label: { en: "Two" }, blocks: [] }] }],
    },
  ],
};

const BUILDERS: Record<string, () => { doc: unknown; expect: DocFixtureExpect; issue?: string }> = {
  // --- accepted -------------------------------------------------------------
  blank: () => ({ doc: doc([]), expect: "ok" }),
  "hero-only": () => ({ doc: doc([section(1, "1", [[hero(1)]])]), expect: "ok" }),
  "three-column": () => ({
    doc: doc([
      section(1, "1", [[hero(1)]]),
      section(2, "1-1-1", [[paragraph(1, "One")], [paragraph(2, "Two"), divider(1)], []], {
        emphasis: "subtle",
        spacing: "spacious",
        phone: "hide-second",
        lock: "content-only",
      }),
    ]),
    expect: "ok",
  }),
  "de-only": () => ({
    doc: doc(
      [
        section(1, "2-1", [
          [
            {
              id: id("p", 1),
              type: "richText",
              content: {
                de: [
                  { type: "heading", level: 2, content: [{ type: "text", text: "Erste Schritte" }] },
                  {
                    type: "bulletList",
                    items: [
                      { content: [{ type: "text", text: "Vertrag lesen", marks: [{ type: "bold" }] }] },
                      { content: [{ type: "text", text: "Hilfe", marks: [{ type: "link", href: "mailto:hr@example.com" }] }] },
                    ],
                  },
                ],
              },
            },
          ],
          [divider(1)],
        ]),
      ],
      { meta: { sourceLocale: "de", title: { de: "Willkommen" } } },
    ),
    expect: "ok",
  }),
  "de-partial": () => ({
    doc: doc(
      [
        section(1, "1-2", [
          [hero(1)],
          [
            {
              id: id("p", 1),
              type: "richText",
              content: {
                de: [{ type: "paragraph", content: [{ type: "text", text: "Nur auf Deutsch" }] }],
                en: [
                  {
                    type: "orderedList",
                    items: [{ content: [{ type: "text", text: "See ", marks: [{ type: "italic" }] }] }],
                  },
                  { type: "paragraph", content: [{ type: "text", text: "the guide", marks: [{ type: "link", href: "/console/pages/guide" }] }] },
                ],
                basis: { en: "0123456789abcdef0123456789abcdef01234567" },
              },
            },
          ],
        ]),
      ],
      { meta: { sourceLocale: "de", title: { de: "Willkommen", en: "Welcome" } } },
    ),
    expect: "ok",
  }),
  "hero-with-media": () => ({
    doc: doc([
      section(1, "1", [[{ ...hero(1), media: { mediaId: mid(1), alt: { en: "Team photo" } } }]]),
    ]),
    expect: "ok",
  }),

  // --- every block family alone (pages-doc-schema-blocks) --------------------
  "block-hero": alone(heroWithButton(1)),
  "block-richText": alone(paragraph(1, "Plain paragraph")),
  "block-divider": alone(divider(1)),
  "block-media": alone(media(1)),
  "block-gallery": alone(gallery(1, 3)),
  "block-featureGrid": alone(featureGrid(1, 3)),
  "block-benefits": alone(benefits(1, 3)),
  "block-faq": alone(faq(1, 3)),
  "block-cta": alone(cta(1, { type: "openPage", pageId: PAGE_ID })),
  "block-appCards": alone(appCards(1)),
  "block-widget": alone(widget(1)),
  "block-tabs": alone(tabs(1, 2, (i) => (i === 0 ? [paragraph(1, "First tab")] : []))),
  "media-video": alone(video(1)),
  "media-decorative": alone(media(1, { alt: undefined, decorative: true, caption: undefined })),
  "cta-request-access": alone(cta(1, { type: "requestAccess", appId: "contracts" }, { heading: undefined, style: "secondary" })),
  "cta-open-url": alone(cta(1, { type: "openUrl", url: "https://example.com/start?x=1" })),
  "app-cards-all-visible": alone(appCards(1, { source: "all-visible" })),
  "richtext-for-faq": alone({
    id: id("p", 1),
    type: "richText",
    content: {
      en: [
        { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
        { type: "heading", level: 2, content: [{ type: "text", text: "What is it?" }] },
        { type: "paragraph", content: [{ type: "text", text: "A placeholder." }] },
        { type: "heading", level: 3, content: [{ type: "text", text: "How?" }] },
        { type: "bulletList", items: [{ content: [{ type: "text", text: "Step" }] }] },
      ],
      de: [
        { type: "heading", level: 2, content: [{ type: "text", text: "Was ist das?" }] },
        { type: "paragraph", content: [{ type: "text", text: "Ein Platzhalter." }] },
        { type: "heading", level: 2, content: [{ type: "text", text: "Wie?" }] },
      ],
      basis: { de: SHA1 },
    },
  }),

  // --- the corpus: templates, extremes, languages, hostile text -------------
  "template-blank": () => ({ doc: doc([]), expect: "ok" }),
  "template-landing": () => ({
    doc: doc([
      section(1, "1", [[heroWithButton(1)]], { emphasis: "strong", spacing: "spacious" }),
      section(2, "2-1", [[featureGrid(1, 6)], [benefits(1, 4)]]),
      section(3, "1", [[cta(1, { type: "openUrl", url: "https://example.com/" })]], { emphasis: "subtle" }),
    ]),
    expect: "ok",
  }),
  "template-dashboard": () => ({
    doc: doc([
      section(1, "1", [[hero(1)]]),
      section(2, "1-1", [[widget(1)], [widget(2, 5)]], { phone: "hide-second" }),
      section(3, "1", [[appCards(1, { source: "all-visible" })]]),
    ]),
    expect: "ok",
  }),
  "template-app-intro": () => ({
    doc: doc([
      section(1, "1-1", [[heroWithButton(1)], [video(1)]], { lock: "content-only" }),
      section(2, "1", [[featureGrid(1, 4), gallery(1, 6)]], { lock: "content-only" }),
      section(3, "1-1", [[benefits(1, 3)], [faq(1, 5)]], { lock: "content-only" }),
      section(4, "1", [[cta(1, { type: "requestAccess", appId: "contracts" })]], { lock: "content-only" }),
    ]),
    expect: "ok",
  }),
  "max-size": () => ({
    doc: doc([
      section(1, "1-1-1", [
        [featureGrid(1, 12), benefits(1, 8)],
        [gallery(1, 24), faq(1, 30)],
        [appCards(1, { appIds: Array.from({ length: 12 }, (_, i) => `app-${i}`) }), widget(1, 20)],
      ]),
      section(2, "1", [[tabs(1, 6, (i) => [paragraph(i, `Tab body ${i}`)])]]),
    ]),
    expect: "ok",
  }),
  "stale-translation": () => ({
    doc: doc(
      [section(1, "1", [[{ ...faq(1, 1), heading: { en: "Questions", de: "Fragen", basis: { de: SHA1 } } }]])],
      { meta: { sourceLocale: "en", title: { en: "Welcome", de: "Willkommen", basis: { de: SHA1 } } } },
    ),
    expect: "ok",
  }),
  "xss-as-text": () => ({
    doc: doc([
      section(1, "1", [
        [
          paragraph(1, "<script>alert(1)</script>"),
          cta(1, { type: "openApp", appId: "contracts" }, { label: { en: "<img src=x onerror=alert(1)>" } }),
          { ...faq(1, 1), heading: { en: "\"><svg onload=alert(1)>" } },
        ],
      ]),
    ]),
    expect: "ok",
  }),
  "unicode-rtl-zero-width": () => ({
    doc: doc([
      section(1, "1", [
        [
          { ...hero(1), heading: { en: "\u0645\u0631\u062d\u0628\u0627 \u200fright-to-left\u200f", de: "zero\u200bwidth \u202eoverride\u202c" } },
          paragraph(1, "\u05e9\u05dc\u05d5\u05dd \ud83d\udc4b\u200d"),
        ],
      ]),
    ]),
    expect: "ok",
  }),
  "max-nesting": () => ({
    doc: doc([
      section(1, "1", [
        [tabs(1, 2, (i) => (i === 0 ? [faq(1, 2), media(1)] : [gallery(1, 2), cta(1, { type: "openPage", pageId: PAGE_ID })]))],
      ]),
    ]),
    expect: "ok",
  }),

  // --- refused --------------------------------------------------------------
  "link-javascript": () => ({ doc: doc([section(1, "1", [[link(1, "javascript:alert(1)")]])]), expect: "invalid" }),
  "link-data": () => ({ doc: doc([section(1, "1", [[link(1, "data:text/html,<b>x</b>")]])]), expect: "invalid" }),
  "link-protocol-relative": () => ({ doc: doc([section(1, "1", [[link(1, "//evil.example")]])]), expect: "invalid" }),
  "link-backslash": () => ({ doc: doc([section(1, "1", [[link(1, "\\\\evil.example")]])]), expect: "invalid" }),
  "unknown-block": () => ({
    doc: doc([section(1, "1", [[{ id: id("x", 1), type: "iframe", src: "https://example.com" }]])]),
    expect: "invalid",
  }),
  "unknown-key": () => ({ doc: doc([section(1, "1", [[{ ...divider(1), style: "color:red" }]])]), expect: "invalid" }),
  "four-columns": () => ({ doc: doc([section(1, "1-1-1-1", [[], [], [], []])]), expect: "invalid" }),
  "layout-column-mismatch": () => ({ doc: doc([section(1, "1-1", [[], [], []])]), expect: "invalid" }),
  "stack-reverse": () => ({ doc: doc([section(1, "1-1", [[], []], { phone: "stack-reverse" })]), expect: "invalid" }),
  "151-blocks": () => ({
    doc: doc([
      section(1, "1-1-1", [
        Array.from({ length: 50 }, (_, i) => divider(i)),
        Array.from({ length: 50 }, (_, i) => divider(100 + i)),
        Array.from({ length: 51 }, (_, i) => divider(200 + i)),
      ]),
    ]),
    expect: "invalid",
    issue: "too_many_blocks",
  }),
  "duplicate-id": () => ({ doc: doc([section(1, "1", [[divider(1), divider(1)]])]), expect: "invalid", issue: "duplicate_id" }),
  "depth-6": () => ({ doc: doc([section(1, "1", [[deepTabs]])]), expect: "invalid", issue: "too_deep" }),
  "bad-id": () => ({ doc: doc([section(1, "1", [[{ id: "Short", type: "divider" }]])]), expect: "invalid" }),
  "no-locale": () => ({ doc: doc([], { meta: { sourceLocale: "en", title: {} } }), expect: "invalid" }),
  "basis-not-sha1": () => ({
    doc: doc([], { meta: { sourceLocale: "en", title: { en: "Hi", de: "Hallo", basis: { de: "abc" } } } }),
    expect: "invalid",
  }),
  "bad-source-locale": () => ({ doc: doc([], { meta: { sourceLocale: "fr", title: { en: "Hi" } } }), expect: "invalid" }),
  "heading-level-1": () => ({
    doc: doc([
      section(1, "1", [
        [{ id: id("p", 1), type: "richText", content: { en: [{ type: "heading", level: 1, content: [] }] } }],
      ]),
    ]),
    expect: "invalid",
  }),
  "list-31-items": () => ({
    doc: doc([
      section(1, "1", [
        [
          {
            id: id("p", 1),
            type: "richText",
            content: {
              en: [{ type: "bulletList", items: Array.from({ length: 31 }, () => ({ content: [{ type: "text", text: "x" }] })) }],
            },
          },
        ],
      ]),
    ]),
    expect: "invalid",
  }),
  v1: () => ({
    doc: { version: 1, slug: "welcome", title: "Welcome", icon: "W", navSection: "Overview", visibleToRoles: ["admin"] },
    expect: "too_old",
  }),
  "v1-schemaVersion": () => ({ doc: doc([], { schemaVersion: 1 }), expect: "too_old" }),
  v3: () => ({ doc: doc([], { schemaVersion: 3 }), expect: "too_new" }),
  "media-url": () => ({
    doc: doc([
      section(1, "1", [[{ ...hero(1), media: { mediaId: "https://evil.example/x.png", alt: { en: "x" } } }]]),
    ]),
    expect: "invalid",
  }),
  "hero-media-no-alt": () => ({ doc: doc([section(1, "1", [[{ ...hero(1), media: { mediaId: mid(1) } }]])]), expect: "invalid" }),
  "tabs-in-tabs": refused(tabs(1, 2, (i) => (i === 0 ? [tabs(2, 2)] : []))),
  "tabs-7": refused(tabs(1, 7)),
  "tabs-1": refused(tabs(1, 1)),
  "cta-open-url-http": refused(cta(1, { type: "openUrl", url: "http://example.com/" })),
  "cta-open-url-mailto": refused(cta(1, { type: "openUrl", url: "mailto:hr@example.com" })),
  "cta-open-page-slug": refused(cta(1, { type: "openPage", pageId: "welcome" })),
  "cta-unknown-action": refused(cta(1, { type: "runScript", script: "x" })),
  "gallery-25": refused(gallery(1, 25)),
  "gallery-empty": refused(gallery(1, 0)),
  "media-no-alt": refused(media(1, { alt: undefined })),
  "media-alt-and-decorative": refused(media(1, { decorative: true })),
  "media-poster-on-image": refused(media(1, { posterRef: { mediaId: mid(2) } })),
  "media-id-short": refused(media(1, { mediaRef: { mediaId: "med_01HXYZ" } })),
  "gallery-item-no-alt": refused(gallery(1, 2, (i) => (i === 1 ? { alt: undefined } : {}))),
  "feature-grid-13": refused(featureGrid(1, 13)),
  "benefits-9": refused(benefits(1, 9)),
  "faq-31": refused(faq(1, 31)),
  "faq-duplicate-item-id": refused({ ...faq(1, 2), items: faq(1, 2).items.map((it) => ({ ...it, id: id("qq", 1) })) }, "duplicate_id"),
  "app-cards-13": refused(appCards(1, { appIds: Array.from({ length: 13 }, (_, i) => `app-${i}`) })),
  "app-cards-both": refused(appCards(1, { appIds: ["contracts"], source: "all-visible" })),
  "widget-21-keys": refused(widget(1, 21)),
  "widget-nested-config": refused({ ...widget(1), config: { a: { b: 1 } } }),
};

/** Every named fixture, built fresh. */
export const DOC_FIXTURES: ReadonlyArray<DocFixture> = Object.entries(BUILDERS).map(([name, build]) => ({
  name,
  ...build(),
}));

/**
 * A fresh copy of a named fixture's doc, or a generated one:
 * - `fixtureDoc("sections", n)`: n one-column sections holding one divider each;
 * - `fixtureDoc("paragraph-bytes", n)`: one paragraph of n ASCII characters.
 */
export function fixtureDoc(name: string, n = 0): unknown {
  if (name === "sections") {
    return doc(Array.from({ length: n }, (_, i) => section(i, "1", [[divider(i)]])));
  }
  if (name === "paragraph-bytes") {
    return doc([section(1, "1", [[paragraph(1, "x".repeat(n))]])]);
  }
  const build = BUILDERS[name];
  if (!build) throw new Error(`no PageDoc fixture named '${name}'`);
  return build().doc;
}
