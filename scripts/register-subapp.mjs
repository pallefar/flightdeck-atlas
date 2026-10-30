#!/usr/bin/env node
// Put Atlas in the OS's sub-app registry — a dry run by default.
//
//   node scripts/register-subapp.mjs --registry ../wt-central-updater/subapps.json \
//     --base-url https://atlas.example.test --version 1.0.1 [--write]
//
// The registry is a shared file in another repo. Without --write this only says
// what it would change, so nobody's uncommitted work is touched by accident.
import { readFileSync, writeFileSync } from "node:fs";
import { registerAtlas } from "../lib/suite/registration.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const registryPath = flag("registry", "../wt-central-updater/subapps.json");
const baseUrl = flag("base-url", "");
const version = flag("version", "");
const write = args.includes("--write");

if (!baseUrl || !version) {
  console.error("--base-url and --version are required: the registry must not be guessed.");
  process.exit(2);
}
const before = JSON.parse(readFileSync(registryPath, "utf8"));
const { registry, added } = registerAtlas(before, baseUrl, version, new Date().toISOString());
if (!added) {
  console.log(`atlas is already registered in ${registryPath}; nothing to do.`);
  process.exit(0);
}
const text = `${JSON.stringify(registry, null, 2)}\n`;
if (!write) {
  console.log(`would add to ${registryPath}:\n`);
  console.log(JSON.stringify(registry.installs.at(-1), null, 2));
  console.log("\nre-run with --write to apply.");
  process.exit(0);
}
writeFileSync(registryPath, text);
console.log(`atlas registered in ${registryPath}.`);
