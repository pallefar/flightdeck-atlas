/**
 * Admin feedback notes — what an admin marks while walking the app, and the
 * one prompt those marks become.
 *
 * Plain data and pure functions, no React and no app imports: the overlay (./index.tsx) captures a note from the element that was right-clicked,
 * and `buildPrompt` turns the whole set into text to paste to Claude.
 *
 * What a note records about an element is deliberately structural: where it
 * is (page, section heading, selector, test id) and, for controls and
 * headings only, its label. The text of an ordinary element is NOT recorded,
 * because on this app that text can be a requisition's or a person's data.
 * The one exception is text the admin selected themselves before right-clicking.
 */

export type FeedbackNote = {
  id: string;
  /** Pathname the note was made on; the pin shows only here. */
  path: string;
  /** Document title at the time, for the prompt. */
  pageTitle: string;
  /** CSS selector that finds the element again; "" for a general note. */
  selector: string;
  tag: string;
  testId: string;
  /** Nearest enclosing section heading or aria-label. */
  section: string;
  /** Label of a control or heading (button text, aria-label, placeholder). */
  label: string;
  /** Text the admin had selected, if any. */
  selected: string;
  comment: string;
  viewport: string;
  createdAt: string;
};

export const NOTES_KEY = "gta-feedback-notes-v1";
export const MODE_KEY = "gta-feedback-on";
export const TOOL_KEY = "gta-feedback-tool";

/** Annotate: the page is frozen and a click or right-click marks. Browse: the page works as normal. */
export type Tool = "annotate" | "browse";

const LABELLED_TAGS = new Set(["button", "a", "label", "summary", "legend", "th", "h1", "h2", "h3", "h4", "h5", "h6", "option", "input", "select", "textarea"]);

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Generated ids (React's `:r1:`, long digit runs, hashes) change between loads. */
const stableId = (id: string) => !!id && !/^:|\d{4,}|[0-9a-f]{8,}/i.test(id);
/** CSS-module and utility noise is a poor handle; keep short semantic classes. */
const stableClass = (name: string) => /^[a-z][a-z0-9-]{2,30}$/i.test(name) && !/\d{3,}/.test(name);

const esc = (value: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&"));

/** A selector for `el`: stops at the nearest test id or stable id, else climbs at most six levels. */
export function selectorFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth += 1, node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (tag === "body" || tag === "html") break;
    const testId = node.getAttribute("data-testid");
    if (testId) { parts.unshift(`[data-testid="${testId.replace(/"/g, '\\"')}"]`); break; }
    if (stableId(node.id)) { parts.unshift(`#${esc(node.id)}`); break; }
    let part = tag;
    const classes = Array.from(node.classList).filter(stableClass).slice(0, 2);
    if (classes.length) part += classes.map(name => `.${esc(name)}`).join("");
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter(child => child.tagName === node!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
  }
  return parts.join(" > ");
}

/** The label of a control or heading; "" for anything else, so data text stays out. */
export function labelFor(el: Element): string {
  const aria = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "";
  if (aria) return clip(aria, 80);
  const tag = el.tagName.toLowerCase();
  if (!LABELLED_TAGS.has(tag) && el.getAttribute("role") !== "button" && el.getAttribute("role") !== "tab") return "";
  if (tag === "input" || tag === "select" || tag === "textarea") return "";
  return clip(el.textContent || "", 80);
}

/** The heading of the section the element sits in, else the page's h1. */
export function sectionFor(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const named = node.getAttribute("aria-label");
    if (named && node !== el && node.tagName !== "NAV") return clip(named, 60);
    if (node.matches("section, article, aside, form, dialog, [role=region], [role=tabpanel], .card, .rl-card")) {
      const heading = node.querySelector("h1, h2, h3, h4, legend");
      if (heading?.textContent) return clip(heading.textContent, 60);
    }
  }
  const h1 = el.ownerDocument.querySelector("h1");
  return h1?.textContent ? clip(h1.textContent, 60) : "";
}

export type Target = Pick<FeedbackNote, "selector" | "tag" | "testId" | "section" | "label">;

export function describeTarget(el: Element): Target {
  return {
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    testId: el.closest("[data-testid]")?.getAttribute("data-testid") || "",
    section: sectionFor(el),
    label: labelFor(el),
  };
}

/** Notes read back from storage: anything malformed is dropped, never thrown on. */
export function parseNotes(raw: string | null): FeedbackNote[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((item): FeedbackNote[] => {
      if (!item || typeof item !== "object") return [];
      const n = item as Record<string, unknown>;
      const text = (key: string) => (typeof n[key] === "string" ? (n[key] as string) : "");
      if (!text("id") || !text("comment")) return [];
      return [{
        id: text("id"), path: typeof n.path === "string" ? n.path : "/", pageTitle: text("pageTitle"), selector: text("selector"),
        tag: text("tag"), testId: text("testId"), section: text("section"), label: text("label"),
        selected: text("selected"), comment: text("comment"), viewport: text("viewport"), createdAt: text("createdAt"),
      }];
    });
  } catch { return []; }
}

const intro = (appName: string) => [
  `I walked through ${appName} with the admin feedback overlay on and left the notes below.`,
  "Each note says where it is (page, section, element) and what I want changed.",
  "Please work through them one by one: find the code behind each, make the change, and tell me which note each change answers.",
  "If a note is unclear or two notes conflict, ask me before changing anything. Do not change anything I have not described.",
].join(" ");

/** Notes in prompt order: page by page (as first met), each page's in the order made, general notes last. */
export function orderNotes(notes: FeedbackNote[]): FeedbackNote[] {
  const pages = new Map<string, FeedbackNote[]>();
  const general: FeedbackNote[] = [];
  for (const note of notes) {
    if (note.path === "") general.push(note);
    else pages.set(note.path, [...(pages.get(note.path) ?? []), note]);
  }
  return [...Array.from(pages.values()).flat(), ...general];
}

export function buildPrompt(notes: FeedbackNote[], opts: { origin?: string; now?: Date; appName?: string } = {}): string {
  if (!notes.length) return "";
  const stamp = (opts.now ?? new Date()).toISOString().slice(0, 16).replace("T", " ");
  const lines: string[] = [intro(opts.appName || "the app"), "", `${notes.length} note${notes.length === 1 ? "" : "s"} · ${opts.origin ? `${opts.origin} · ` : ""}captured ${stamp} UTC`, ""];
  let heading: string | null = null;
  orderNotes(notes).forEach((note, index) => {
    if (note.path !== heading) {
      heading = note.path;
      const title = notes.find(item => item.path === note.path && item.pageTitle)?.pageTitle;
      lines.push(note.path === "" ? "## General (not tied to one page)" : `## ${note.path}${title ? ` — ${title}` : ""}`, "");
    }
    lines.push(...noteLines(note, index + 1), "");
  });
  return lines.join("\n").trimEnd() + "\n";
}

function noteLines(note: FeedbackNote, number: number): string[] {
  const out = [`${number}. ${note.comment.trim().replace(/\n/g, "\n   ")}`];
  const where: string[] = [];
  if (note.section) where.push(`section "${note.section}"`);
  if (note.tag && note.selector) where.push(`<${note.tag}>${note.label ? ` "${note.label}"` : ""}`);
  if (where.length) out.push(`   - Where: ${where.join(", ")}`);
  if (note.selected) out.push(`   - Selected text: "${clip(note.selected, 200)}"`);
  if (note.testId) out.push(`   - data-testid: ${note.testId}`);
  if (note.selector) out.push(`   - Selector: ${note.selector}`);
  if (note.viewport) out.push(`   - Viewport: ${note.viewport}`);
  return out;
}

export const newNoteId = () => `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
