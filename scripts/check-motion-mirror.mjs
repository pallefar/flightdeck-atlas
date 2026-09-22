// Checks that lib/motion is still a byte-identical copy of the FlightDeck OS
// motion layer (flightdeck/web/src/motion), so the two apps keep one motion
// language. lib/motion/README.md ("The mirror") says why.
//
//   node scripts/check-motion-mirror.mjs <FlightDeck OS checkout> [ref]
//
// <FlightDeck OS checkout> is any checkout of pallefar/project-contract.
// [ref] is where the OS layer lives now (default origin/feat/anime-motion-os;
// origin/main once that branch merges). Run `git fetch` there first: the check
// reads the ref as the checkout knows it. It fails when:
//   - a file's header does not name a commit, or the files name different ones;
//   - the code below a header differs from that commit (an edit made in Atlas);
//   - the code differs from [ref] (the OS moved on: copy the files again);
//   - lib/motion holds a file that is neither a copy nor one of Atlas's own
//     (a copy the OS has since removed, left behind), or [ref] has a file that
//     is neither copied nor listed as not copied (the OS added one).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const FILES = ["motion.ts", "useMotion.ts", "entrances.ts", "disclosure.ts", "presence.ts"];
/** Atlas's own files in lib/motion (README.md says why). */
const ATLAS_OWN = ["README.md", "env.d.ts"];
/** OS files Atlas does not copy: its own README, and TabIndicator.tsx
 * (Atlas's pill-tab indicator slides in CSS). */
const NOT_COPIED = ["README.md", "TabIndicator.tsx"];
const OS_DIR = "flightdeck/web/src/motion";
const COMMIT = /^\/\/ MIRROR of FlightDeck OS \S+ at commit ([0-9a-f]{40})$/;

/** The header: the leading `//` lines, then, in useMotion.ts, one eslint-disable block. */
function splitHeader(text) {
  const lines = text.split("\n");
  let n = 0;
  while (lines[n]?.startsWith("//")) n++;
  if (lines[n]?.startsWith("/* eslint-disable")) {
    while (n < lines.length && !lines[n].includes("*/")) n++;
    n++;
  }
  const header = lines.slice(0, n).join("\n") + "\n";
  return { commit: lines[0].match(COMMIT)?.[1], body: text.slice(header.length) };
}

const [osCheckout, ref = "origin/feat/anime-motion-os"] = process.argv.slice(2);
if (!osCheckout) {
  console.error("Usage: node scripts/check-motion-mirror.mjs <FlightDeck OS checkout> [ref]");
  process.exit(2);
}
const git = (...args) => execFileSync("git", ["-C", osCheckout, ...args], { encoding: "utf8", maxBuffer: 1 << 24 });
const refSha = git("rev-parse", `${ref}^{commit}`).trim();
/** A file of the OS layer at a commit, or null when that commit has no such
 * file (the OS removed or renamed it). */
function osFile(sha, file) {
  try {
    return execFileSync("git", ["-C", osCheckout, "show", `${sha}:${OS_DIR}/${file}`], { encoding: "utf8", maxBuffer: 1 << 24, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const problems = [];
const commits = new Set();
for (const file of FILES) {
  const atlas = readFileSync(new URL(`../lib/motion/${file}`, import.meta.url), "utf8");
  const { commit, body } = splitHeader(atlas);
  if (!commit) {
    problems.push(`${file}: no MIRROR header naming a commit`);
    continue;
  }
  commits.add(commit);
  const copied = osFile(commit, file);
  const current = osFile(refSha, file);
  if (copied === null) problems.push(`${file}: ${commit.slice(0, 8)}, the commit its header names, has no such file`);
  else if (body !== copied) problems.push(`${file}: differs from ${commit.slice(0, 8)}, the commit its header names (edited in Atlas?)`);
  else if (current === null) problems.push(`${file}: ${ref} (${refSha.slice(0, 8)}) no longer has it (the OS removed it). Copy the layer again.`);
  else if (body !== current) problems.push(`${file}: ${ref} (${refSha.slice(0, 8)}) has a different version than the copied ${commit.slice(0, 8)}. Copy it again.`);
}
for (const file of readdirSync(new URL("../lib/motion/", import.meta.url)))
  if (!FILES.includes(file) && !ATLAS_OWN.includes(file))
    problems.push(`${file}: in lib/motion but neither a copy nor one of Atlas's own files (the OS removed it?)`);
for (const path of git("ls-tree", "--name-only", `${refSha}:${OS_DIR}`).split("\n").filter(Boolean))
  if (!FILES.includes(path) && !NOT_COPIED.includes(path))
    problems.push(`${path}: ${ref} (${refSha.slice(0, 8)}) has it, and it is neither copied nor listed as not copied`);
if (commits.size > 1) problems.push(`the headers name different commits: ${[...commits].join(", ")}`);

if (problems.length) {
  console.error(`lib/motion is out of step with the OS motion layer (${ref} = ${refSha.slice(0, 8)}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`lib/motion matches the OS motion layer at ${refSha.slice(0, 8)} (${ref}): ${FILES.length} files.`);
