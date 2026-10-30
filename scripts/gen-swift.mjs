#!/usr/bin/env node
// Generate the macOS client's contract models from schema/*.schema.json, and
// copy the fixtures the Swift tests decode, so the native client cannot drift
// from the web: both are generated from the same schemas and held to the same
// recorded fixtures.
//
//   node scripts/gen-swift.mjs
//
// The output is committed, so a model change shows up in review. `swift test`
// then decodes the same fixtures the Playwright suite does.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
// A file URL is percent-encoded; this checkout's path contains a space.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA_DIR = join(ROOT, "schema");
const OUT_DIR = join(ROOT, "atlas/macos/Atlas/Sources/AtlasDomain");
const FIXTURE_OUT = join(ROOT, "atlas/macos/Atlas/Tests/AtlasDomainTests/Fixtures");
const FIXTURE_IN = join(ROOT, "tests/fixtures");
const STRUCT_NAMES = {
  "atlas-evidence/1": "AtlasEvidence",
  "atlas-gate-event/1": "AtlasGateEvent",
  "atlas-value/1": "AtlasValue",
  "atlas-onboarding-record/1": "AtlasOnboardingRecord",
  "atlas-process-steps/1": "AtlasProcessSteps",
  "atlas-workflow-draft/1": "AtlasWorkflowDraft",
};
const CAMEL = /[^a-zA-Z0-9]/g;
const ident = (name) => name.replace(CAMEL, "");
const upper = (name) => name.charAt(0).toUpperCase() + name.slice(1);
const caseName = (value) => {
  const parts = String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return parts
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
};
// Swift reserves these; an enum case may carry one in backticks, and the
// wire value stays the schema's string either way.
const RESERVED = new Set([
  "public", "internal", "private", "fileprivate", "open", "case", "default",
  "class", "struct", "enum", "protocol", "extension", "func", "import", "let",
  "var", "if", "else", "for", "while", "return", "switch", "break", "continue",
  "guard", "defer", "do", "try", "catch", "throw", "throws", "rethrows", "in",
  "is", "as", "self", "super", "nil", "true", "false", "operator", "static",
  "final", "where", "inout", "init", "deinit", "subscript", "lazy", "mutating",
  "override", "required", "convenience", "dynamic",
]);
const safeCase = (name) => (RESERVED.has(name) ? `\`${name}\`` : name);
const isEnum = (node) => Array.isArray(node.enum) && node.enum.some((v) => v !== null);
const isNullable = (node) =>
  (Array.isArray(node.type) ? node.type : [node.type]).includes("null") ||
  (Array.isArray(node.enum) && node.enum.includes(null));
/** The Swift type of one schema node. `prefix` names the struct that owns the
 * enums, so two contracts can both have a `stage` without colliding. */
function swiftType(node, key, prefix, nestedName) {
  if (isEnum(node)) return `${prefix}${upper(ident(key))}`;
  if (node.const !== undefined) return "String";
  const base = (Array.isArray(node.type) ? node.type : [node.type]).find(
    (t) => t && t !== "null",
  );
  if (base === "integer") return "Int";
  if (base === "number") return "Double";
  if (base === "boolean") return "Bool";
  if (base === "array") {
    const item = node.items ?? {};
    if (item.type === "object") return `[${nestedName}]`;
    if (isEnum(item)) return `[${prefix}${upper(ident(key))}]`;
    return "[String]";
  }
  if (base === "object") return nestedName;
  return "String";
}
function enumDecl(name, node) {
  const values = node.enum.filter((v) => v !== null);
  const cases = values
    .map((v) => `  case ${safeCase(caseName(v))} = ${JSON.stringify(String(v))}`)
    .join("\n");
  return `public enum ${name}: String, Codable, CaseIterable, Sendable {\n${cases}\n}`;
}
/** A plain object property gets its own struct, named after the property; an
 * array of objects uses `<Owner>Item`. Both are declared beside their owner. */
function nestedFor(node, key, owner) {
  if (node.type === "array" && node.items?.type === "object") return `${owner}Item`;
  const base = Array.isArray(node.type) ? node.type.find((t) => t && t !== "null") : node.type;
  if (base === "object") return `${owner}${upper(ident(key))}`;
  return undefined;
}
function typeOf(node, key, name) {
  const nestedName = nestedFor(node, key, name);
  let type = swiftType(node, key, name, nestedName);
  if (isNullable(node) && !type.endsWith("?")) type += "?";
  return type;
}
function structDecl(name, schema) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const declarations = [];
  const fields = [];
  const inits = [];
  const params = [];
  for (const [key, node] of Object.entries(properties)) {
    if (isEnum(node)) declarations.push(enumDecl(`${name}${upper(ident(key))}`, node));
    if (node.type === "array" && node.items?.type === "object")
      declarations.push(structDecl(`${name}Item`, node.items));
    const objectProp = nestedFor(node, key, name);
    if (objectProp && !(node.type === "array"))
      declarations.push(structDecl(objectProp, node));
    let type = typeOf(node, key, name);
    if (!required.has(key) && !type.endsWith("?")) type += "?";
    fields.push(`  public let ${ident(key)}: ${type}`);
    inits.push(`    self.${ident(key)} = ${ident(key)}`);
    params.push(`${ident(key)}: ${type}`);
  }
  const codingKeys = Object.entries(properties)
    .map(([key]) => `    case ${ident(key)} = ${JSON.stringify(key)}`)
    .join("\n");
  return [
    ...declarations,
    `public struct ${name}: Codable, Equatable, Sendable {`,
    ...fields,
    "",
    `  public init(${params.join(", ")}) {`,
    ...inits,
    "  }",
    "",
    "  enum CodingKeys: String, CodingKey {",
    codingKeys,
    "  }",
    "}",
  ].join("\n");
}
const files = readdirSync(SCHEMA_DIR)
  .filter((name) => name.endsWith(".schema.json"))
  .sort();
const chunks = [
  "// GENERATED by scripts/gen-swift.mjs from schema/*.schema.json. Do not edit.",
  "// Run `npm run gen:swift` after changing a schema. The Swift tests decode",
  "// the same fixtures as the Playwright suite, so the two cannot drift.",
  "import Foundation",
  "",
];
for (const file of files) {
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8"));
  const name = STRUCT_NAMES[schema.$id];
  if (!name) continue;
  chunks.push(structDecl(name, schema), "");
}
const rendered = chunks.join("\n");
const target = join(OUT_DIR, "Generated.swift");
// `--check` proves the committed model still matches the schemas; the test
// suite runs it so a schema change cannot silently leave the native client
// behind.
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (current !== rendered) {
    console.error("Generated.swift is stale. Run: node scripts/gen-swift.mjs");
    process.exit(1);
  }
  console.log("Swift contract models match schema/*.schema.json");
  process.exit(0);
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(target, rendered);
mkdirSync(FIXTURE_OUT, { recursive: true });
for (const file of readdirSync(FIXTURE_IN).filter((n) => /^atlas-.*\.v1\.json$/.test(n)))
  writeFileSync(join(FIXTURE_OUT, file), readFileSync(join(FIXTURE_IN, file)));
const digest = createHash("sha256").update(chunks.join("\n")).digest("hex").slice(0, 12);
console.log(`generated ${files.length} contract models (${digest}) and copied their fixtures`);
