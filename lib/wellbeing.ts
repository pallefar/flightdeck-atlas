import { z } from "zod";
export const habits = [
  "Step away from the screen",
  "Take a water break",
  "Make time to move",
  "Set a finish time",
] as const;
export const moods = [
  { value: 1, icon: "😟", label: "Low" },
  { value: 2, icon: "😕", label: "Flat" },
  { value: 3, icon: "😐", label: "Steady" },
  { value: 4, icon: "🙂", label: "Good" },
  { value: 5, icon: "😄", label: "Great" },
] as const;
const rating = z.number().int().min(1).max(5).nullable();
export const wellbeingSchema = z.object({
  date: z.string(),
  mood: rating,
  energy: rating,
  rest: rating,
  clarity: rating,
  habits: z.array(z.string()).max(4),
  sessions: z.number().int().min(0).max(1000),
  preferences: z.object({
    focus: z.number().int().min(5).max(90),
    short: z.number().int().min(1).max(30),
    long: z.number().int().min(5).max(60),
  }),
  timer: z.object({
    mode: z.enum(["focus", "short", "long"]),
    status: z.enum(["idle", "running", "paused"]),
    duration: z.number().min(0).max(5400),
    remaining: z.number().min(0).max(5400),
    endAt: z.number().nullable(),
  }),
  notice: z.enum(["focus", "short", "long"]).nullable(),
});
export type WellbeingState = z.infer<typeof wellbeingSchema>;
export type FocusMode = WellbeingState["timer"]["mode"];
export function localDay(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function freshWellbeing(now = Date.now()): WellbeingState {
  return {
    date: localDay(now),
    mood: null,
    energy: null,
    rest: null,
    clarity: null,
    habits: [],
    sessions: 0,
    preferences: { focus: 25, short: 5, long: 15 },
    timer: {
      mode: "focus",
      status: "idle",
      duration: 1500,
      remaining: 1500,
      endAt: null,
    },
    notice: null,
  };
}
export function remainingTime(state: WellbeingState, now = Date.now()) {
  return state.timer.status === "running" && state.timer.endAt !== null
    ? Math.max(0, Math.ceil((state.timer.endAt - now) / 1000))
    : state.timer.remaining;
}
export function readiness(
  state: Pick<WellbeingState, "energy" | "rest" | "clarity">,
) {
  return state.energy === null || state.rest === null || state.clarity === null
    ? null
    : Math.round(((state.energy + state.rest + state.clarity) / 15) * 100);
}
export function advanceWellbeing(
  state: WellbeingState,
  now = Date.now(),
): WellbeingState {
  let next = state;
  if (state.date !== localDay(now))
    next = {
      ...freshWellbeing(now),
      preferences: state.preferences,
      timer:
        state.timer.status === "idle"
          ? {
              mode: "focus",
              status: "idle",
              duration: state.preferences.focus * 60,
              remaining: state.preferences.focus * 60,
              endAt: null,
            }
          : state.timer,
      notice: null,
    };
  if (next.timer.status === "running" && remainingTime(next, now) === 0) {
    // An elapsed session belongs to the day its deadline fell on, not the day the app reopened.
    if (
      next.timer.endAt !== null &&
      localDay(next.timer.endAt) !== localDay(now)
    ) {
      const duration = next.preferences.focus * 60;
      return {
        ...next,
        notice: null,
        timer: {
          mode: "focus",
          status: "idle",
          duration,
          remaining: duration,
          endAt: null,
        },
      };
    }
    const completed = next.timer.mode;
    const sessions = next.sessions + (completed === "focus" ? 1 : 0);
    const mode: FocusMode =
      completed === "focus" ? (sessions % 4 === 0 ? "long" : "short") : "focus";
    const duration = next.preferences[mode] * 60;
    return {
      ...next,
      sessions,
      notice: completed,
      timer: {
        mode,
        status: "idle",
        duration,
        remaining: duration,
        endAt: null,
      },
    };
  }
  return next;
}
export function readWellbeing(raw: string | null, now = Date.now()) {
  try {
    const parsed = wellbeingSchema.parse(JSON.parse(raw || "null"));
    if (parsed.timer.status === "running" && parsed.timer.endAt === null)
      return freshWellbeing(now);
    return advanceWellbeing(parsed, now);
  } catch {
    return freshWellbeing(now);
  }
}
const thoughts = [
  "A pause is part of the work, not time taken from it.",
  "Choose one useful next step. Let the rest wait its turn.",
  "You can care deeply about the work and still close the laptop.",
  "A clear mind often starts with a few quiet minutes.",
  "Make room in the day for the person doing the work.",
  "Progress can be gentle and still move you forward.",
  "Give your attention to one thing, then give yourself a break.",
  "Some of your best thinking happens away from the screen.",
  "A realistic plan leaves room to breathe.",
  "Finishing a small thing is a good place to begin.",
  "Your pace can change without changing your purpose.",
  "Leave a little energy for the life after work.",
];
export function dailyThought(day: string) {
  return thoughts[
    [...day].reduce((sum, c) => sum + c.charCodeAt(0), 0) % thoughts.length
  ];
}
