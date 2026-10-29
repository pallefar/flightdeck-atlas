/**
 * Admin feedback notes — how a note is read back and how the prompt is built,
 * without a browser. Invented values only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, orderNotes, parseNotes, type FeedbackNote } from "../components/feedback-overlay/notes";

const note = (over: Partial<FeedbackNote>): FeedbackNote => ({
  id: "a", path: "/reports", pageTitle: "Recruiter Studio", selector: '[data-testid="x"] > button', tag: "button", testId: "x",
  section: "Candidate review", label: "Approve", selected: "", comment: "Make this blue", viewport: "1440x900", createdAt: "2026-10-29T12:00:00Z", ...over,
});

test("prompt groups notes by page, numbers them across pages, and puts general notes last", () => {
  const notes = [
    note({ id: "1", path: "/reports", comment: "first" }),
    note({ id: "2", path: "/operator", pageTitle: "Operator", comment: "second" }),
    note({ id: "3", path: "", selector: "", tag: "", testId: "", section: "", label: "", pageTitle: "", comment: "general" }),
    note({ id: "4", path: "/reports", comment: "third", selected: "some words" }),
  ];
  assert.deepEqual(orderNotes(notes).map(n => n.id), ["1", "4", "2", "3"]);
  const prompt = buildPrompt(notes, { origin: "http://localhost:3000", now: new Date("2026-10-29T12:00:00Z") });
  assert.match(prompt, /4 notes · http:\/\/localhost:3000 · captured 2026-10-29 12:00 UTC/);
  assert.ok(prompt.indexOf("## /reports") < prompt.indexOf("## /operator") && prompt.indexOf("## /operator") < prompt.indexOf("## General"));
  assert.match(prompt, /2\. third[\s\S]*Selected text: "some words"/);
  assert.match(prompt, /3\. second/);
  assert.match(prompt, /4\. general/);
  assert.match(prompt, /Where: section "Candidate review", <button> "Approve"/);
  assert.equal(buildPrompt([]), "");
});

test("stored notes: malformed entries are dropped, a general note keeps its empty path", () => {
  assert.deepEqual(parseNotes(null), []);
  assert.deepEqual(parseNotes("not json"), []);
  assert.deepEqual(parseNotes('{"a":1}'), []);
  const kept = parseNotes(JSON.stringify([note({ id: "g", path: "", selector: "" }), { id: "", comment: "x" }, { id: "n" }, 7, null]));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].path, "");
});
