import { test, expect } from "@playwright/test";
import {
  advanceWellbeing,
  freshWellbeing,
  readiness,
  readWellbeing,
  remainingTime,
} from "../lib/wellbeing";
test("readiness requires complete input; deadline completion is once-only and never auto-starts a break", () => {
  const now = Date.now(),
    s = freshWellbeing(now);
  expect(readiness(s)).toBe(null);
  expect(readiness({ ...s, rest: 3, energy: 4, clarity: 5 })).toBe(80);
  const running = {
    ...s,
    sessions: 3,
    timer: { ...s.timer, status: "running" as const, endAt: now - 1 },
  };
  const completed = advanceWellbeing(running, now);
  expect(completed.sessions).toBe(4);
  expect(completed.timer.mode).toBe("long");
  expect(completed.timer.status).toBe("idle");
  expect(advanceWellbeing(completed, now + 60000).sessions).toBe(4);
  expect(
    remainingTime(
      {
        ...s,
        timer: { ...s.timer, status: "paused", remaining: 200, endAt: null },
      },
      now + 60000,
    ),
  ).toBe(200);
  expect(readWellbeing("broken").mood).toBe(null);
  const nextDay = advanceWellbeing(
    { ...completed, mood: 5, rest: 4, habits: ["a"] },
    now + 86400000,
  );
  expect(nextDay.mood).toBe(null);
  expect(nextDay.sessions).toBe(0);
  expect(nextDay.habits).toEqual([]);
  const discoveredTomorrow = advanceWellbeing(running, now + 86400000);
  expect(discoveredTomorrow.sessions).toBe(0);
  expect(discoveredTomorrow.timer.mode).toBe("focus");
  expect(discoveredTomorrow.notice).toBe(null);
});
test("personal check-in and timer survive views and reload, then offer a break", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-17T10:00:00Z") });
  await page.goto("/?view=wellbeing");
  await page.getByRole("button", { name: "Mood: Good", exact: true }).click();
  for (const [label, n] of [
    ["Rested", 3],
    ["Energized", 4],
    ["Clear-headed", 5],
  ])
    await page
      .getByRole("button", { name: `${label}: ${n} of 5`, exact: true })
      .click();
  await expect(
    page.getByLabel("Self-reported readiness 80 out of 100"),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Take a water break" }).check();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.fastForward(60000);
  await expect(page.getByRole("timer")).toHaveText("24:00");
  await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("24:00");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Mood: Good", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pause timer", exact: true }).click();
  await page.clock.fastForward(60000);
  await expect(page.getByRole("timer")).toHaveText("24:00");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.fastForward(24 * 60000);
  await expect(
    page.getByText("Focus complete. Time for a pause.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText("05:00");
  await expect(
    page.getByRole("button", { name: "Pause timer", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Dismiss wellbeing reminder" })
    .click();
  await page
    .getByRole("button", { name: "Wellbeing", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Take a water break" }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Clear personal data", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear check-ins and timer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mood: Good", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("timer")).toHaveText("25:00");
});
test("wellbeing and a running timer fit mobile, and Outlook has no invented content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/?view=wellbeing");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.getByRole("button", { name: "Microsoft 365 setup" }).click();
  await expect(
    page.getByRole("dialog", { name: "Bring Outlook into your day" }),
  ).toContainText("No mailbox or calendar data");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("switch", { name: "Wellbeing widget" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Daily wellbeing and focus" }),
  ).toHaveCount(0);
  await expect(page.locator(".focus-badge")).toBeVisible();
});
