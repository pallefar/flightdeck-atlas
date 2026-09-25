import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { goldenAdapters, normalizeGoldenHtml } from "../lib/pagedoc/fixtures/golden.js";
import { DOC_FIXTURES } from "../lib/pagedoc/fixtures/index.js";
import { PageDocRenderer } from "../lib/pagedoc/render/index.js";
import { parsePageDoc, type PageDocV2 } from "../lib/pagedoc/schema/index.js";
import { PAGEDOC_ADAPTER_CONTRACT_VERSION } from "../lib/pagedoc/adapters.js";
import { PAGEDOC_READABLE_VERSIONS } from "../lib/pagedoc/schema/index.js";
import { readAtlasPageDoc } from "../lib/pagedoc-atlas";

// lib/pagedoc is a byte-for-byte mirror of the FlightDeck OS portable PageDoc
// tree (flightdeck/pagedoc, plan 2026-09-25 Lane C, pages-atlas-mirror-contract).
// The OS ships MANIFEST.json with the sha256 of every file; Atlas vendors it
// and checks its copies against it, with no sibling OS checkout. No browser,
// no server: these run the check script and the mirror in-process, under
// Atlas's own installed zod (3.25, via zod/v4) and React.

const root = fileURLToPath(new URL("..", import.meta.url));
const MIRROR = path.join(root, "lib", "pagedoc");
const CHECK = path.join(root, "scripts", "check-pagedoc-mirror.mjs");

function check(dir?: string) {
  return spawnSync(process.execPath, [CHECK, ...(dir ? [dir] : [])], {
    cwd: root,
    encoding: "utf8",
  });
}

/** A scratch copy of the mirror the test may break. */
function scratchCopy() {
  const dir = mkdtempSync(path.join(tmpdir(), "pagedoc-mirror-"));
  const copy = path.join(dir, "pagedoc");
  cpSync(MIRROR, copy, { recursive: true });
  return { copy, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const manifest = () =>
  JSON.parse(readFileSync(path.join(MIRROR, "MANIFEST.json"), "utf8")) as {
    schemaVersions: number[];
    adapterContract: string;
    files: { path: string; sha256: string }[];
  };

test.describe("the vendored manifest check", () => {
  test("the committed mirror matches its vendored MANIFEST.json", () => {
    const run = check();
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${manifest().files.length} files`);
  });

  test("a clean copy passes", () => {
    const { copy, done } = scratchCopy();
    try {
      const run = check(copy);
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
    } finally {
      done();
    }
  });

  test("one modified byte below a header fails, naming the file", () => {
    const { copy, done } = scratchCopy();
    try {
      const file = path.join(copy, "schema", "limits.ts");
      const bytes = readFileSync(file);
      const i = bytes.length - 2;
      bytes[i] = bytes[i] === 0x20 ? 0x21 : 0x20;
      writeFileSync(file, bytes);
      const run = check(copy);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("schema/limits.ts");
    } finally {
      done();
    }
  });

  test("one modified byte in a golden (no header) fails", () => {
    const { copy, done } = scratchCopy();
    try {
      appendFileSync(path.join(copy, "fixtures", "blank.en.html"), " ");
      const run = check(copy);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("fixtures/blank.en.html");
    } finally {
      done();
    }
  });

  test("the header line is excluded from the hash, but must be there", () => {
    const { copy, done } = scratchCopy();
    try {
      const file = path.join(copy, "adapters.ts");
      const [header, ...rest] = readFileSync(file, "utf8").split("\n");
      expect(header).toMatch(/^\/\/ MIRROR of FlightDeck OS flightdeck\/pagedoc\/adapters\.ts at commit [0-9a-f]{40}\b/);
      // the header's wording is not hashed: rewording it keeps the body valid
      writeFileSync(file, [`${header} (reworded)`, ...rest].join("\n"));
      expect(check(copy).status).toBe(0);
      // no header at all: refused (a copy nobody can trace)
      writeFileSync(file, rest.join("\n"));
      const run = check(copy);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("adapters.ts");
    } finally {
      done();
    }
  });

  test("a missing file, an extra file and an edited manifest fail", () => {
    const { copy, done } = scratchCopy();
    try {
      unlinkSync(path.join(copy, "render", "blocks", "faq.ts"));
      writeFileSync(path.join(copy, "render", "extra.ts"), "export {};\n");
      const run = check(copy);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("render/blocks/faq.ts");
      expect(run.stderr).toContain("render/extra.ts");
    } finally {
      done();
    }
    const second = scratchCopy();
    try {
      const m = JSON.parse(readFileSync(path.join(second.copy, "MANIFEST.json"), "utf8"));
      m.adapterContract = "999";
      writeFileSync(path.join(second.copy, "MANIFEST.json"), JSON.stringify(m, null, 2) + "\n");
      const run = check(second.copy);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("adapterContract");
    } finally {
      second.done();
    }
  });

  test("npm run lint runs the check", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.lint).toContain("scripts/check-pagedoc-mirror.mjs");
    expect(pkg.scripts["check:pagedoc"]).toContain("scripts/check-pagedoc-mirror.mjs");
  });
});

test.describe("the mirror under Atlas's own zod and React", () => {
  test("Atlas resolves zod 3.25 and React 19.2 (the versions the brief pins)", () => {
    const require = createRequire(import.meta.url);
    const zod = require(path.join(root, "node_modules", "zod", "package.json")).version as string;
    const react = require(path.join(root, "node_modules", "react", "package.json")).version as string;
    expect(zod).toMatch(/^3\.25\./);
    expect(react).toMatch(/^19\.2\./);
  });

  test("the manifest's versions are the mirror's exports", () => {
    const m = manifest();
    expect(m.schemaVersions).toEqual([...PAGEDOC_READABLE_VERSIONS]);
    expect(m.adapterContract).toBe(String(PAGEDOC_ADAPTER_CONTRACT_VERSION));
  });

  test("parsePageDoc gives every fixture its expected result", () => {
    expect(DOC_FIXTURES.length).toBeGreaterThan(10);
    for (const f of DOC_FIXTURES) {
      const r = parsePageDoc(f.doc);
      if (f.expect === "ok") {
        expect(r.ok, `${f.name}: ${JSON.stringify(r.ok ? null : r.issues)}`).toBe(true);
      } else {
        expect(r.ok, f.name).toBe(false);
        if (!r.ok) {
          expect(r.code, f.name).toBe(f.expect);
          if (f.issue) expect(r.issues.map((i) => i.code), f.name).toContain(f.issue);
        }
      }
    }
  });

  test("every accepted fixture renders its golden HTML with Atlas's React", () => {
    const accepted = DOC_FIXTURES.filter((f) => f.expect === "ok");
    expect(accepted.length).toBeGreaterThan(5);
    for (const f of accepted) {
      const r = parsePageDoc(f.doc);
      expect(r.ok, f.name).toBe(true);
      const doc = (r as { ok: true; doc: PageDocV2 }).doc;
      for (const locale of ["en", "de"] as const) {
        const golden = path.join(MIRROR, "fixtures", `${f.name}.${locale}.html`);
        expect(existsSync(golden), golden).toBe(true);
        const html = renderToStaticMarkup(
          createElement(PageDocRenderer, { doc, locale, adapters: goldenAdapters() }),
        );
        expect(normalizeGoldenHtml(html), `${f.name}.${locale}`).toBe(readFileSync(golden, "utf8"));
      }
    }
  });
});

test.describe("Atlas's reading of a doc", () => {
  test("a too-new doc says 'This page needs an Atlas update'", () => {
    const tooNew = DOC_FIXTURES.find((f) => f.expect === "too_new");
    expect(tooNew).toBeTruthy();
    const r = readAtlasPageDoc(tooNew!.doc, "en");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("too_new");
      expect(r.message).toBe("This page needs an Atlas update");
    }
    const de = readAtlasPageDoc(tooNew!.doc, "de");
    expect(de.ok).toBe(false);
    if (!de.ok) expect(de.message).not.toBe("This page needs an Atlas update");
  });

  test("an invalid or too-old doc is refused, never half-read", () => {
    for (const f of DOC_FIXTURES.filter((x) => x.expect === "invalid" || x.expect === "too_old")) {
      const r = readAtlasPageDoc(f.doc, "en");
      expect(r.ok, f.name).toBe(false);
      if (!r.ok) {
        expect(r.code, f.name).toBe(f.expect);
        expect(r.message, f.name).toBe("This page cannot be shown");
      }
    }
  });

  test("an accepted doc reads", () => {
    const ok = DOC_FIXTURES.find((f) => f.expect === "ok")!;
    expect(readAtlasPageDoc(ok.doc, "en").ok).toBe(true);
  });
});

test.describe("the token adapter (app/pagedoc-host.css)", () => {
  const hostCss = () => readFileSync(path.join(root, "app", "pagedoc-host.css"), "utf8");
  const globals = () => readFileSync(path.join(root, "app", "globals.css"), "utf8");

  test("maps every --pd-* colour property pagedoc.css reads", () => {
    const pd = readFileSync(path.join(MIRROR, "pagedoc.css"), "utf8");
    const read = new Set(
      [...pd.matchAll(/var\((--pd-[a-z-]+)/g)].map((m) => m[1]).filter((p) => p !== "--pd-fx" && p !== "--pd-fy"),
    );
    expect(read.size).toBeGreaterThan(10);
    const declared = new Set([...hostCss().matchAll(/(--pd-[a-z-]+)\s*:/g)].map((m) => m[1]));
    for (const p of read) expect(declared.has(p), p).toBe(true);
  });

  test("adds no new tokens: every declaration is a --pd-* mapped to an existing Atlas token", () => {
    const css = hostCss().replace(/\/\*[\s\S]*?\*\//g, "");
    const atlasTokens = new Set([...globals().matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
    const decls = [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)];
    expect(decls.length).toBeGreaterThan(10);
    for (const [, prop, value] of decls) {
      expect(prop, `${prop} is not a --pd-* property`).toMatch(/^--pd-/);
      const refs = [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
      expect(refs.length, `${prop}: ${value}`).toBeGreaterThan(0);
      for (const r of refs) expect(atlasTokens.has(r), `${prop} reads ${r}, not an Atlas token`).toBe(true);
    }
  });

  test("rich-text lists keep their markers under Tailwind's preflight; card lists stay unmarked", async ({ page }) => {
    // Atlas loads Tailwind's preflight (app/globals.css), which strips list
    // markers and padding from every ul/ol. Rendered in a real browser with the
    // same cascade order as app/layout.tsx: preflight, pagedoc.css, the adapter.
    const read = (p: string) => readFileSync(p, "utf8");
    const require = createRequire(import.meta.url);
    const preflight = read(require.resolve("tailwindcss/preflight.css"));
    const golden = (name: string) => read(path.join(MIRROR, "fixtures", `${name}.en.html`));
    await page.setContent(
      `<!doctype html><html><head><style>${preflight}</style><style>${read(path.join(MIRROR, "pagedoc.css"))}</style>` +
        `<style>${hostCss()}</style></head><body>` +
        // richtext-for-faq has a bullet list, de-partial a numbered one; an FAQ
        // answer is itself .pd-rich-text; the feature grid is a card list.
        `${golden("richtext-for-faq")}${golden("de-partial")}` +
        `<div class="pd-faq-a pd-rich-text"><ul><li>Answer</li></ul></div>${golden("block-featureGrid")}</body></html>`,
    );
    const style = (sel: string) =>
      page.locator(sel).first().evaluate((el) => {
        const s = getComputedStyle(el);
        return { type: s.listStyleType, pad: parseFloat(s.paddingInlineStart) };
      });
    const ul = await style(".pd-rich-text ul");
    expect(ul.type).toBe("disc");
    expect(ul.pad).toBeGreaterThan(0);
    const ol = await style(".pd-rich-text ol");
    expect(ol.type).toBe("decimal");
    expect(ol.pad).toBeGreaterThan(0);
    const faq = await style(".pd-faq-a ul");
    expect(faq.type).toBe("disc");
    expect(faq.pad).toBeGreaterThan(0);
    expect((await style(".pd-feature-list")).type).toBe("none");
  });

  test("the layout loads the mirror's stylesheet and the adapter", () => {
    const layout = readFileSync(path.join(root, "app", "layout.tsx"), "utf8");
    expect(layout).toContain('import "../lib/pagedoc/pagedoc.css";');
    expect(layout).toContain('import "./pagedoc-host.css";');
  });
});
