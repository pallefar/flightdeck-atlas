"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Coffee,
  Heart,
  Mail,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  advanceWellbeing,
  dailyThought,
  freshWellbeing,
  habits,
  moods,
  readWellbeing,
  readiness,
  remainingTime,
  type FocusMode,
  type WellbeingState,
} from "@/lib/wellbeing";
type WellbeingContextValue = {
  data: WellbeingState | null;
  now: number;
  warning: string;
  update: (fn: (s: WellbeingState) => WellbeingState) => void;
  clear: () => void;
};
const WellnessContext = createContext<WellbeingContextValue | null>(null);
export function WellbeingProvider({
  userId,
  children,
}: {
  userId?: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<WellbeingState | null>(null),
    [now, setNow] = useState(Date.now),
    [warning, setWarning] = useState("");
  const activeKey = useRef<string | null>(null);
  const key = userId ? `atlas-wellbeing-v1:${userId}` : null;
  useEffect(() => {
    activeKey.current = key;
    if (!key) {
      setData(null);
      return;
    }
    try {
      setData(readWellbeing(localStorage.getItem(key)));
    } catch {
      setData(freshWellbeing());
      setWarning(
        "Browser storage is unavailable. Your check-in and timer will last only for this session.",
      );
    }
    const receive = (event: StorageEvent) => {
      if (event.key === key) setData(readWellbeing(event.newValue));
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, [key]);
  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      setNow(time);
      setData((previous) =>
        previous ? advanceWellbeing(previous, time) : null,
      );
    };
    const interval = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  function update(fn: (s: WellbeingState) => WellbeingState) {
    setData((previous) => {
      if (!previous) return previous;
      const next = fn(advanceWellbeing(previous));
      try {
        if (activeKey.current)
          localStorage.setItem(activeKey.current, JSON.stringify(next));
      } catch {
        setWarning(
          "Changes apply now, but could not be saved to this browser.",
        );
      }
      return next;
    });
  }
  // Completion/day rollover must survive reload even when no control is pressed.
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (loadedKey.current !== key) {
      loadedKey.current = key;
      return;
    }
    if (data && key && activeKey.current === key) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        setWarning(
          "Changes apply now, but could not be saved to this browser.",
        );
      }
    }
  }, [data, key]);
  function clear() {
    setData(freshWellbeing());
    try {
      if (key) localStorage.removeItem(key);
      setWarning("");
    } catch {
      setWarning(
        "Data was reset for this session, but browser storage could not be cleared.",
      );
    }
  }
  return (
    <WellnessContext.Provider value={{ data, now, warning, update, clear }}>
      {children}
    </WellnessContext.Provider>
  );
}
export function useWellbeing() {
  return useContext(WellnessContext)!;
}
const modeNames = { focus: "Focus", short: "Short break", long: "Long break" };
function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function setMode(state: WellbeingState, mode: FocusMode): WellbeingState {
  const duration = state.preferences[mode] * 60;
  return {
    ...state,
    notice: null,
    timer: { mode, duration, remaining: duration, status: "idle", endAt: null },
  };
}
function Timer({ compact = false }: { compact?: boolean }) {
  const { data, now, update } = useWellbeing();
  if (!data) return null;
  const remaining = remainingTime(data, now),
    running = data.timer.status === "running";
  const ratio = data.timer.duration ? remaining / data.timer.duration : 0;
  return (
    <div
      className={`focus-clock ${compact ? "compact" : ""} ${data.timer.mode !== "focus" ? "break-clock" : ""}`}
    >
      {!compact && (
        <div className="filter-tabs timer-modes">
          {(["focus", "short", "long"] as const).map((mode) => (
            <button
              key={mode}
              disabled={running}
              className={data.timer.mode === mode ? "chosen" : ""}
              aria-pressed={data.timer.mode === mode}
              onClick={() => update((s) => setMode(s, mode))}
            >
              {modeNames[mode]}
            </button>
          ))}
        </div>
      )}
      <div className="clock-body">
        <div className="clock-dial" aria-hidden="true">
          <svg viewBox="0 0 120 120">
            <circle className="clock-track" cx="60" cy="60" r="52" />
            <circle
              className="clock-progress"
              cx="60"
              cy="60"
              r="52"
              strokeDasharray={327}
              strokeDashoffset={327 * (1 - ratio)}
            />
          </svg>
          {data.timer.mode === "focus" ? <Sparkles /> : <Coffee />}
        </div>
        <div>
          <span className="wellbeing-kicker">{modeNames[data.timer.mode]}</span>
          <strong
            className="clock-time"
            role="timer"
            aria-label={`${modeNames[data.timer.mode]} time remaining`}
          >
            {clock(remaining)}
          </strong>
          <small>
            {data.sessions} focus {data.sessions === 1 ? "session" : "sessions"}{" "}
            today
          </small>
        </div>
      </div>
      <div className="clock-actions">
        <Button
          aria-label={running ? "Pause timer" : "Start timer"}
          onClick={() =>
            update((s) =>
              running
                ? {
                    ...s,
                    timer: {
                      ...s.timer,
                      status: "paused",
                      remaining: remainingTime(s),
                      endAt: null,
                    },
                  }
                : {
                    ...s,
                    notice: null,
                    timer: {
                      ...s.timer,
                      status: "running",
                      endAt: Date.now() + s.timer.remaining * 1000,
                    },
                  },
            )
          }
        >
          {running ? <Pause size={14} /> : <Play size={14} />}{" "}
          {running
            ? "Pause"
            : data.timer.status === "paused"
              ? "Resume"
              : data.timer.mode === "focus"
                ? "Start focus"
                : "Start break"}
        </Button>
        <button
          className="wellbeing-icon-button"
          aria-label="Reset timer"
          title="Reset timer"
          onClick={() => update((s) => setMode(s, s.timer.mode))}
        >
          <RotateCcw size={15} />
        </button>
        {compact && data.timer.mode === "focus" && !running && (
          <button
            className="text-link"
            onClick={() => update((s) => setMode(s, "short"))}
          >
            Take a break
          </button>
        )}
      </div>
    </div>
  );
}
export function FocusBadge({ onOpen }: { onOpen: () => void }) {
  const { data, now } = useWellbeing();
  return data?.timer.status === "running" ? (
    <button
      className="focus-badge"
      onClick={onOpen}
      aria-label={`Open wellbeing, ${modeNames[data.timer.mode]} timer ${clock(remainingTime(data, now))}`}
    >
      <span />
      {clock(remainingTime(data, now))}
    </button>
  ) : null;
}
export function WellbeingNotice() {
  const { data, update } = useWellbeing();
  if (!data?.notice) return null;
  return (
    <aside className="wellbeing-notice" role="status">
      <Coffee size={23} />
      <div>
        <strong>
          {data.notice === "focus"
            ? "Focus complete. Time for a pause."
            : "Break complete. Choose your next step."}
        </strong>
        <p>
          {data.notice === "focus"
            ? `${data.timer.mode === "long" ? "A longer" : "A short"} break is ready. Step away, stretch or get some water.`
            : "Start another focus session when you feel ready."}
        </p>
      </div>
      <Button
        onClick={() =>
          update((s) => ({
            ...s,
            notice: null,
            timer: {
              ...s.timer,
              status: "running",
              endAt: Date.now() + s.timer.remaining * 1000,
            },
          }))
        }
      >
        {data.notice === "focus" ? "Start break" : "Start focus"}
      </Button>
      <button
        aria-label="Dismiss wellbeing reminder"
        onClick={() => update((s) => ({ ...s, notice: null }))}
      >
        <X size={17} />
      </button>
    </aside>
  );
}
function MoodControl() {
  const { data, update } = useWellbeing();
  if (!data) return null;
  return (
    <div className="mood-control" aria-label="Mood check-in">
      {moods.map((m) => (
        <button
          key={m.value}
          aria-label={`Mood: ${m.label}`}
          aria-pressed={data.mood === m.value}
          onClick={() => update((s) => ({ ...s, mood: m.value }))}
        >
          <span>{m.icon}</span>
          <small>{m.label}</small>
        </button>
      ))}
    </div>
  );
}
function ReadinessRing() {
  const { data } = useWellbeing();
  const score = data ? readiness(data) : null;
  return (
    <div
      className="readiness-ring"
      style={{ "--readiness": `${score || 0}%` } as React.CSSProperties}
      aria-label={
        score === null
          ? "Readiness not checked in"
          : `Self-reported readiness ${score} out of 100`
      }
    >
      <span>
        <strong>{score === null ? "—" : score}</strong>
        <small>{score === null ? "CHECK IN" : "/ 100"}</small>
      </span>
    </div>
  );
}
export function WellbeingDashboard({ onOpen }: { onOpen: () => void }) {
  const { data } = useWellbeing();
  if (!data) return null;
  return (
    <section
      className="wellbeing-dashboard"
      aria-label="Daily wellbeing and focus"
    >
      <div className="wellbeing-daily">
        <div className="wellbeing-line">
          <span className="wellbeing-kicker">
            <Heart size={14} /> YOUR PACE TODAY
          </span>
          <button className="text-link" onClick={onOpen}>
            Wellbeing <ArrowUpRight size={13} />
          </button>
        </div>
        <MoodControl />
        <div className="wellbeing-checkin-link">
          <span>
            Readiness{" "}
            <strong>
              {readiness(data) ?? "Not checked in"}
              {readiness(data) !== null ? " / 100" : ""}
            </strong>
          </span>
          <button className="text-link" onClick={onOpen}>
            {readiness(data) === null ? "Check in" : "Review"}
          </button>
        </div>
      </div>
      <Timer compact />
      <button className="day-overview-link" onClick={onOpen}>
        <span>
          <CalendarDays size={18} />
          <Mail size={17} />
        </span>
        <strong>Your day, in one place</strong>
        <small>Outlook email & calendar</small>
        <span className="wellbeing-kicker">
          NOT CONNECTED <ArrowUpRight size={13} />
        </span>
      </button>
    </section>
  );
}
export default function WellbeingPage() {
  const { data, warning, update, clear } = useWellbeing();
  const [setup, setSetup] = useState(false),
    [confirmClear, setConfirmClear] = useState(false);
  if (!data)
    return (
      <main className="hub-page">
        <p>Loading your personal space…</p>
      </main>
    );
  return (
    <main className="hub-page wellbeing-page">
      <div className="hub-heading">
        <div>
          <span className="eyebrow">SPACE FOR YOU</span>
          <h1>Work well. Feel better.</h1>
          <p>
            Your pace, your focus, your day. Check-ins stay in this browser for
            your account.
          </p>
        </div>
        <Heart className="hub-heading-icon" size={29} />
      </div>
      {warning && (
        <p className="form-error" role="alert">
          {warning}
        </p>
      )}
      <div className="wellbeing-grid">
        <section className="hub-card checkin-card">
          <h2>
            <Heart size={19} />
            How are you arriving today?
          </h2>
          <MoodControl />
          <div className="readiness-checkin">
            <ReadinessRing />
            <div>
              <h3>Your readiness</h3>
              <p>
                A personal reflection, based equally on rest, energy and
                clarity. It is not a health assessment.
              </p>
            </div>
          </div>
          <div className="readiness-inputs">
            {(
              [
                ["rest", "Rested"],
                ["energy", "Energized"],
                ["clarity", "Clear-headed"],
              ] as const
            ).map(([key, label]) => (
              <fieldset key={key}>
                <legend>
                  {label}
                  <span>
                    {data[key] === null ? "Not rated" : `${data[key]} / 5`}
                  </span>
                </legend>
                <div>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      aria-label={`${label}: ${n} of 5`}
                      aria-pressed={data[key] === n}
                      onClick={() => update((s) => ({ ...s, [key]: n }))}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <p className="wellbeing-note">
            Mood is kept separate from the score. There is no target to hit.
          </p>
        </section>
        <section className="hub-card focus-card">
          <h2>
            <Sparkles size={19} />
            One thing at a time
          </h2>
          <Timer />
          <p className="hub-muted">
            A longer break follows four focus sessions. Each session starts when
            you choose; breaks never auto-start.
          </p>
          <details className="timer-settings">
            <summary>
              <Settings2 size={15} />
              Timer lengths
            </summary>
            <div>
              {(
                [
                  ["focus", "Focus minutes"],
                  ["short", "Short break minutes"],
                  ["long", "Long break minutes"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    disabled={data.timer.status === "running"}
                    aria-label={label}
                    value={data.preferences[key]}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      update((s) => {
                        const next = {
                          ...s,
                          preferences: { ...s.preferences, [key]: value },
                        };
                        return s.timer.mode === key ? setMode(next, key) : next;
                      });
                    }}
                  >
                    {(key === "focus"
                      ? [5, 15, 25, 45, 60, 90]
                      : key === "short"
                        ? [1, 3, 5, 10, 15, 30]
                        : [5, 10, 15, 20, 30, 60]
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n} minutes
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
          <p className="wellbeing-note">
            The timer survives reloads. Reminders appear inside Atlas when it’s
            open or when you return.
          </p>
        </section>
        <section className="hub-card">
          <h2>
            <Coffee size={19} />
            Small moments that count
          </h2>
          <p className="hub-muted">
            A few gentle prompts for today. Choose what works for you.
          </p>
          <div className="wellbeing-habits">
            {habits.map((h) => (
              <label key={h}>
                <input
                  type="checkbox"
                  checked={data.habits.includes(h)}
                  onChange={() =>
                    update((s) => ({
                      ...s,
                      habits: s.habits.includes(h)
                        ? s.habits.filter((x) => x !== h)
                        : [...s.habits, h],
                    }))
                  }
                />
                <span>{h}</span>
                {data.habits.includes(h) && <Check size={16} />}
              </label>
            ))}
          </div>
          <blockquote className="daily-thought">
            <span>QUOTE OF THE DAY</span>
            <p>“{dailyThought(data.date)}”</p>
            <cite>Atlas · original daily reflection</cite>
          </blockquote>
        </section>
        <section className="hub-card personal-overview">
          <h2>
            <CalendarDays size={19} />
            Your day, together
          </h2>
          <p className="hub-muted">
            A place for email priorities, upcoming meetings and space to focus.
          </p>
          <div className="personal-source">
            <Mail size={21} />
            <div>
              <h3>Outlook email summary</h3>
              <p>Important threads, follow-ups and decisions.</p>
            </div>
            <span>Not connected</span>
          </div>
          <div className="personal-source">
            <CalendarDays size={21} />
            <div>
              <h3>Outlook calendar</h3>
              <p>Upcoming meetings and available focus time.</p>
            </div>
            <span>Not connected</span>
          </div>
          <p className="wellbeing-note">
            No email or calendar has been read. Connecting requires your
            Microsoft 365 sign-in and an approved app connection.
          </p>
          <Button variant="outline" onClick={() => setSetup(true)}>
            Microsoft 365 setup <ArrowUpRight size={14} />
          </Button>
        </section>
      </div>
      <div className="wellbeing-privacy">
        <span>
          Private check-ins · reset for each local day · no team scoreboards
        </span>
        <button className="text-link" onClick={() => setConfirmClear(true)}>
          Clear personal data
        </button>
      </div>
      <Dialog open={setup} onOpenChange={setSetup}>
        <DialogContent className="project-dialog">
          <DialogTitle>Bring Outlook into your day</DialogTitle>
          <DialogDescription>
            Microsoft 365 is not connected. No mailbox or calendar data is
            available in Atlas yet.
          </DialogDescription>
          <ol className="outlook-steps">
            <li>
              Register Atlas with your organization’s Microsoft Entra tenant,
              with a secure sign-in callback and server-side token storage.
            </li>
            <li>
              Connect your own Microsoft account with delegated email and
              calendar read permissions. Your organization may require admin
              approval.
            </li>
            <li>
              Choose what to include and review the summary privacy settings
              before any email content is processed.
            </li>
          </ol>
          <p className="hub-muted">
            The first version should read your own calendar and selected email
            folders, link back to Outlook, and never send email or move meetings
            automatically.
          </p>
          <a
            className="text-link"
            href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/PERSONAL-HUB-CONTRACT.md"
          >
            Microsoft 365 connection requirements <ArrowUpRight size={14} />
          </a>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogTitle>Clear personal data?</DialogTitle>
          <DialogDescription>
            This clears your check-in, habits, focus session count and timer
            preferences in this browser. Any active timer stops. Your projects
            are unchanged.
          </DialogDescription>
          <Button
            onClick={() => {
              clear();
              setConfirmClear(false);
            }}
          >
            Clear check-ins and timer
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
