// Checks that lib/pagedoc is still a byte-for-byte copy of the FlightDeck OS
// portable PageDoc tree (flightdeck/pagedoc: schema, renderer, adapter
// contract, stylesheet, conformance fixtures), plan 2026-09-25 Lane C,
// pages-atlas-mirror-contract. Unlike check-motion-mirror.mjs it needs NO
// sibling OS checkout: the OS ships MANIFEST.json (the sha256 of every file in
// the tree, the schema versions it reads and the host adapter contract
// version), Atlas vendors it next to the copy, and this script checks the
// copy against the vendored manifest only. So it runs anywhere Atlas runs,
// and `npm run lint` runs it.
//
//   node scripts/check-pagedoc-mirror.mjs [dir] [--quiet]
//
// [dir] defaults to lib/pagedoc. --quiet prints nothing on success (lint's
// JSON output must stay clean). Exit 1, listing every problem, when:
//   - MANIFEST.json is missing or malformed;
//   - a listed file is missing, or a file is there that the manifest does not
//     list (MANIFEST.json itself and macOS .DS_Store litter aside);
//   - a .ts, .css or .md copy does not start with its one-line MIRROR header
//     naming its own OS path and a commit, or the headers name different
//     commits;
//   - the bytes (below the header, which is excluded from the hash, as in the
//     motion check) do not hash to the manifest's sha256: an edit made in
//     Atlas. Golden .html fixtures carry no header and are hashed whole;
//   - the manifest's adapterContract or schemaVersions disagree with what the
//     copied adapters.ts and schema declare.
//
// To update the mirror: take the OS tree at a commit whose MANIFEST.json is
// current (the OS's `npm run check:pagedoc` passes), copy every listed file
// here with its header naming that commit, copy MANIFEST.json as it is, and
// run this check and tests/pagedoc-mirror.spec.ts. Release order (the OS
// README): the Atlas mirror ships first; the OS emits a new schema version
// only after Atlas reads it. Never edit a copy here; change the OS first.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const positional = args.filter((a) => !a.startsWith("--"));
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(positional[0] ?? path.join(here, "..", "lib", "pagedoc"));
const MANIFEST = "MANIFEST.json";

const problems = [];
function finish() {
  if (problems.length) {
    console.error(`${dir} is not a clean copy of the OS PageDoc tree (vendored ${MANIFEST}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

let manifest = null;
try {
  manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), "utf8"));
} catch (err) {
  problems.push(`${MANIFEST}: missing or not valid JSON (${err.message})`);
  finish();
}
const files = Array.isArray(manifest?.files) ? manifest.files : null;
if (!files || files.length === 0 || !files.every((f) => typeof f?.path === "string" && /^[0-9a-f]{64}$/.test(f?.sha256 ?? "")))
  problems.push(`${MANIFEST}: "files" must be a non-empty list of {path, sha256}`);
if (!Array.isArray(manifest?.schemaVersions) || manifest.schemaVersions.length === 0 || !manifest.schemaVersions.every(Number.isInteger))
  problems.push(`${MANIFEST}: "schemaVersions" must be a non-empty list of integers`);
if (typeof manifest?.adapterContract !== "string" || !/^\d+$/.test(manifest.adapterContract))
  problems.push(`${MANIFEST}: "adapterContract" must be an integer string`);
finish();

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The one-line header a copy of this kind carries, or null for none. */
function headerPattern(rel) {
  const what = `MIRROR of FlightDeck OS flightdeck/pagedoc/${escape(rel)} at commit ([0-9a-f]{40})\\b`;
  if (rel.endsWith(".ts")) return new RegExp(`^// ${what}[^\\n]*$`);
  if (rel.endsWith(".css")) return new RegExp(`^/\\* ${what}[^\\n]*\\*/$`);
  if (rel.endsWith(".md")) return new RegExp(`^<!-- ${what}[^\\n]*-->$`);
  return null;
}

const listed = new Set();
const commits = new Set();
/** The copied bytes below the header (for the version cross-check). */
const bodies = new Map();
for (const { path: rel, sha256 } of files) {
  listed.add(rel);
  const file = path.join(dir, rel);
  if (!existsSync(file)) {
    problems.push(`${rel}: listed in ${MANIFEST} but missing here`);
    continue;
  }
  let bytes = readFileSync(file);
  const pattern = headerPattern(rel);
  if (pattern) {
    const nl = bytes.indexOf(0x0a);
    const first = nl < 0 ? "" : bytes.subarray(0, nl).toString("utf8");
    const match = pattern.exec(first);
    if (!match) {
      problems.push(`${rel}: no MIRROR header naming its OS path and a commit on its first line`);
      continue;
    }
    commits.add(match[1]);
    bytes = bytes.subarray(nl + 1);
  }
  bodies.set(rel, bytes.toString("utf8"));
  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    problems.push(`${rel}: its bytes${pattern ? " below the header" : ""} do not match the manifest's sha256 (edited in Atlas?)`);
}

function walk(sub) {
  return readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.name === ".DS_Store") return [];
    if (e.isDirectory()) return walk(rel);
    return [rel];
  });
}
for (const rel of walk(""))
  if (rel !== MANIFEST && !listed.has(rel)) problems.push(`${rel}: here but not listed in ${MANIFEST} (a stray or stale copy)`);
if (commits.size > 1) problems.push(`the headers name different commits: ${[...commits].join(", ")}`);

// The manifest's versions against what the copied sources declare (read
// textually; unreadable means refused).
const adapters = bodies.get("adapters.ts") ?? "";
const contract = /\bexport\s+const\s+PAGEDOC_ADAPTER_CONTRACT_VERSION\s*=\s*(\d+)\s*;/.exec(adapters)?.[1];
if (contract === undefined) problems.push("adapters.ts: PAGEDOC_ADAPTER_CONTRACT_VERSION could not be read");
else if (contract !== manifest.adapterContract)
  problems.push(`adapterContract: ${MANIFEST} says ${JSON.stringify(manifest.adapterContract)}, adapters.ts declares "${contract}"`);
const schemaSources = ["schema/envelope.ts", "schema/index.ts"].map((p) => bodies.get(p) ?? "").join("\n");
const current = [...schemaSources.matchAll(/\bexport\s+const\s+PAGEDOC_SCHEMA_VERSION\s*=\s*(\d+)\s*;/g)].map((m) => Number(m[1]));
if (current.length !== 1) problems.push("schema: PAGEDOC_SCHEMA_VERSION could not be read unambiguously");
else if (!manifest.schemaVersions.includes(current[0]))
  problems.push(`schemaVersions: ${MANIFEST} lists ${JSON.stringify(manifest.schemaVersions)}, the schema writes ${current[0]}`);

finish();
if (!quiet) {
  const commit = [...commits][0];
  console.log(
    `lib/pagedoc matches its vendored ${MANIFEST}: ${files.length} files, schema versions [${manifest.schemaVersions}], adapter contract ${manifest.adapterContract}${commit ? `, OS commit ${commit.slice(0, 8)}` : ""}.`,
  );
}
