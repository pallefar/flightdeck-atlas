import { test, expect } from "@playwright/test";
import { deferredQueue } from "../lib/onboarding/deferred";

const now = new Date("2026-10-30T09:00:00.000Z");
const project = (deferred: unknown, id = "p-1", name = "Contract intake") => ({
  projectId: id,
  name,
  deferred,
});

test("a deferred queue puts what is late first, then the soonest", () => {
  const queue = deferredQueue(
    [
      project([
        { stage: "value", owner: "po@example.test", dueAt: "2026-11-05T09:00:00.000Z" },
        { stage: "as-is", owner: "po@example.test", dueAt: "2026-10-28T09:00:00.000Z" },
      ]),
      project([{ stage: "aligned", owner: "adm@example.test", dueAt: "2026-10-29T09:00:00.000Z" }], "p-2", "Invoice exceptions"),
    ],
    now,
  );
  expect(queue.map((item) => item.stage)).toEqual(["as-is", "aligned", "value"]);
  expect(queue[0].overdue).toBe(true);
  expect(queue[0].daysLate).toBe(2);
  expect(queue[2].overdue).toBe(false);
  expect(queue[2].projectName).toBe("Contract intake");
});

test("a malformed entry is skipped, not guessed", () => {
  const queue = deferredQueue(
    [project([{ stage: "as-is" }, { owner: "x" }, "nonsense", { stage: "value", dueAt: "not a date" }])],
    now,
  );
  expect(queue).toEqual([]);
});
