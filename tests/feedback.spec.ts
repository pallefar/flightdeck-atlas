import { test, expect } from "@playwright/test";
import {
  FEEDBACK_PER_HOUR,
  feedbackPrompt,
  feedbackPromptLine,
  feedbackSchema,
  overLimit,
} from "../lib/feedback";

// The feedback shape and the one-prompt rendering, shared by the web lane and
// the desktop app. Structural context only: the privacy rule is a test, not a
// comment.
const note = {
  source: "macos" as const,
  screen: "Project brain",
  projectId: "p-1",
  stage: "capture",
  rating: "minor_issue" as const,
  category: "wording",
  comment: "The scan state is not obvious.",
};
test.describe("the shape", () => {
  test("a normal note parses", () => {
    expect(feedbackSchema.safeParse(note).success).toBe(true);
  });
  test("an unknown field is refused rather than dropped", () => {
    expect(feedbackSchema.safeParse({ ...note, pageText: "secret" }).success).toBe(false);
  });
  test("an unknown rating is refused", () => {
    expect(feedbackSchema.safeParse({ ...note, rating: "great" }).success).toBe(false);
  });
  test("a long comment is bounded", () => {
    expect(feedbackSchema.safeParse({ ...note, comment: "x".repeat(4001) }).success).toBe(false);
  });
});
test.describe("the prompt", () => {
  test("one note becomes one line with its context", () => {
    const line = feedbackPromptLine(note);
    expect(line).toContain("minor_issue/wording");
    expect(line).toContain("project p-1");
    expect(line).toContain("stage capture");
    expect(line).toContain("The scan state is not obvious.");
  });
  test("a note with no comment says so instead of ending in a colon", () => {
    expect(feedbackPromptLine({ ...note, comment: "" })).toContain("(no comment)");
  });
  test("an empty set is an empty prompt, not a header with nothing in it", () => {
    expect(feedbackPrompt([])).toBe("");
  });
  test("several notes become one paste-able prompt", () => {
    const prompt = feedbackPrompt([note, { ...note, rating: "ok", comment: "Good." }]);
    expect(prompt.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
    expect(prompt).toContain("Please address these points.");
  });
});
test.describe("rate limit", () => {
  test("the limit is a number a person cannot reach by accident", () => {
    expect(overLimit(FEEDBACK_PER_HOUR - 1)).toBe(false);
    expect(overLimit(FEEDBACK_PER_HOUR)).toBe(true);
  });
});
