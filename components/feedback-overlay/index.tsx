"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  MODE_KEY,
  TOOL_KEY,
  NOTES_KEY,
  buildPrompt,
  describeTarget,
  newNoteId,
  orderNotes,
  parseNotes,
  type FeedbackNote,
  type Target,
  type Tool,
} from "./notes";
import "./feedback-overlay.css";

/**
 * Admin feedback overlay. Turned on from the header, it lets an admin use the
 * app as normal, right-click anything to leave a comment on it, and collect
 * every comment into one prompt for Claude. Notes live in this browser's
 * localStorage only (nothing is sent anywhere), so they survive navigation
 * between studios and a reload. What a note captures: ./notes.ts.
 *
 * Portable: React and the two files beside this one, nothing else. See README.md.
 */

/** The speech-bubble-with-plus mark (Lucide, ISC), inline so there is no icon dependency. */
const MarkIcon = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M12 7v6M9 10h6" /></svg>;
const CursorIcon = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 4l7.07 17 2.51-7.39L21 11.07z" /></svg>;
const PencilIcon = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.38 3.62a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
const CloseIcon = () => <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>;

type Store = { on: boolean; tool: Tool; notes: FeedbackNote[] };
const OFF: Store = { on: false, tool: "annotate", notes: [] };
let state: Store = OFF;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  try { state = { on: localStorage.getItem(MODE_KEY) === "1", tool: localStorage.getItem(TOOL_KEY) === "browse" ? "browse" : "annotate", notes: parseNotes(localStorage.getItem(NOTES_KEY)) }; }
  catch { state = OFF; }
}
function update(next: Partial<Store>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(MODE_KEY, state.on ? "1" : "0");
    localStorage.setItem(TOOL_KEY, state.tool);
    localStorage.setItem(NOTES_KEY, JSON.stringify(state.notes));
  } catch { /* storage full or blocked: the notes still work for this page view */ }
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  if (!loaded) { loaded = true; load(); }
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== NOTES_KEY && event.key !== MODE_KEY && event.key !== TOOL_KEY) return;
    load();
    listeners.forEach(l => l());
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
const snapshot = () => state;
const serverSnapshot = () => OFF;
function useFeedback() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** The header switch. */
export function FeedbackToggle() {
  const { on, notes } = useFeedback();
  return <button type="button" className="fb-toggle" data-testid="feedback-toggle" aria-pressed={on}
    title={on ? "Feedback mode is on: right-click anything to comment. Click to turn off." : "Turn on feedback mode: right-click anything to leave a comment for Claude."}
    aria-label="Turn feedback mode on or off" onClick={() => update({ on: !on })}>
    <MarkIcon />
    {notes.length ? <span className="fb-count">{notes.length}</span> : null}
  </button>;
}

type Composer = { x: number; y: number; target: Target | null; selected: string; comment: string; editId?: string };
type Pin = { x: number; y: number };

const inUi = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-feedback-ui]");

/** The marking layer, the notes panel, and the dock. Renders nothing while off. */
export function FeedbackOverlay({ pathname, appName }: {
  /** The current route. Pass the router's (Next: `usePathname()`); without it `location.pathname` is read on each render. */
  pathname?: string;
  /** Named in the prompt's first line, e.g. "the GTA Intelligence app". */
  appName?: string;
}) {
  const { on, tool, notes } = useFeedback();
  const annotating = tool === "annotate";
  const path = pathname ?? (typeof window === "undefined" ? "/" : window.location.pathname);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [panel, setPanel] = useState(false);
  const [pins, setPins] = useState<Record<string, Pin | null>>({});
  const [copied, setCopied] = useState(false);
  const notesRef = useRef(notes);
  const pathRef = useRef(path);
  // Refs are updated after commit, not during render: writing them while
  // rendering is what the hooks lint refuses, and nothing here reads them
  // before the first effect runs.
  useEffect(() => {
    notesRef.current = notes;
    pathRef.current = path;
  }, [notes, path]);

  // Annotate: the page is frozen. Hover outlines what a click would mark; a
  // click or right-click opens the composer on it. Browse: none of this runs,
  // and the app works as normal (pins stay, and can still be opened).
  useEffect(() => {
    if (!on) {
      // Scheduled, so the effect body itself never calls setState: turning the
      // overlay off must not cascade a render inside the effect.
      queueMicrotask(() => { setHover(null); setComposer(null); setPanel(false); });
      return;
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setComposer(null); setPanel(false);
    };
    window.addEventListener("keydown", escape);
    if (!annotating) {
      queueMicrotask(() => setHover(null));
      return () => window.removeEventListener("keydown", escape);
    }
    document.documentElement.classList.add("fb-annotating");
    let frame = 0;
    const move = (event: MouseEvent) => {
      if (frame) return;
      const target = event.target;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setHover(target instanceof Element && !inUi(target) ? target.getBoundingClientRect() : null);
      });
    };
    const mark = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || inUi(event.target)) return;
      event.preventDefault();
      if (event.type === "click") event.stopPropagation();   // a click marks; it must not also navigate or act
      const selected = (window.getSelection()?.toString() ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      setHover(null);
      setComposer({ x: event.clientX, y: event.clientY, target: describeTarget(event.target), selected, comment: "" });
    };
    // On window, in the capture phase: ahead of the app's own document-level handlers.
    document.addEventListener("mousemove", move, true);
    window.addEventListener("contextmenu", mark, true);
    window.addEventListener("click", mark, true);
    return () => {
      document.documentElement.classList.remove("fb-annotating");
      document.removeEventListener("mousemove", move, true);
      window.removeEventListener("contextmenu", mark, true);
      window.removeEventListener("click", mark, true);
      window.removeEventListener("keydown", escape);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [on, annotating]);

  // Pins: put a numbered marker on every element commented on this page, and
  // keep it there as the page scrolls, resizes or re-renders.
  const place = useCallback(() => {
    const next: Record<string, Pin | null> = {};
    for (const note of notesRef.current) {
      if (note.path !== pathRef.current || !note.selector) continue;
      let rect: DOMRect | null = null;
      try { rect = document.querySelector(note.selector)?.getBoundingClientRect() ?? null; } catch { rect = null; }
      next[note.id] = rect && (rect.width || rect.height)
        ? { x: Math.min(Math.max(rect.right - 6, 12), window.innerWidth - 24), y: Math.min(Math.max(rect.top - 6, 70), window.innerHeight - 24) }
        : null;
    }
    setPins(prev => {
      const same = Object.keys(next).length === Object.keys(prev).length
        && Object.entries(next).every(([id, pin]) => prev[id]?.x === pin?.x && prev[id]?.y === pin?.y && (prev[id] === null) === (pin === null));
      return same ? prev : next;
    });
  }, []);
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); }); };
    const first = window.setTimeout(place, 250);
    window.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    const observer = new MutationObserver(soon);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [on, place, path, notes]);

  if (!on) return null;

  const ordered = orderNotes(notes);
  const numberOf = (id: string) => ordered.findIndex(note => note.id === id) + 1;
  const prompt = buildPrompt(notes, { origin: typeof window === "undefined" ? undefined : window.location.origin, appName });

  function save() {
    if (!composer || !composer.comment.trim()) return;
    const comment = composer.comment.trim();
    if (composer.editId) update({ notes: notes.map(note => note.id === composer.editId ? { ...note, comment } : note) });
    else update({ notes: [...notes, {
      id: newNoteId(),
      path: composer.target ? path : "",
      pageTitle: composer.target ? document.title : "",
      selector: composer.target?.selector ?? "", tag: composer.target?.tag ?? "", testId: composer.target?.testId ?? "",
      section: composer.target?.section ?? "", label: composer.target?.label ?? "",
      selected: composer.selected, comment,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      createdAt: new Date().toISOString(),
    }] });
    setComposer(null);
  }
  function edit(note: FeedbackNote, x: number, y: number) {
    setComposer({ x, y, target: note.selector ? { selector: note.selector, tag: note.tag, testId: note.testId, section: note.section, label: note.label } : null, selected: note.selected, comment: note.comment, editId: note.id });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); }
    catch {
      const area = document.createElement("textarea");
      area.value = prompt; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  function clearAll() {
    if (notes.length && window.confirm(`Delete all ${notes.length} feedback notes? This cannot be undone.`)) update({ notes: [] });
  }

  const left = composer ? Math.max(8, Math.min(composer.x, window.innerWidth - 348)) : 0;
  const top = composer ? Math.max(8, Math.min(composer.y, window.innerHeight - 270)) : 0;

  return <div className="fb-root" data-feedback-ui data-testid="feedback-overlay">
    {hover && !composer ? <div className="fb-hover" style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }} /> : null}
    {notes.filter(note => note.path === path && note.selector).map(note => {
      const pin = pins[note.id];
      return pin ? <button key={note.id} type="button" className="fb-pin" data-testid="feedback-pin" style={{ left: pin.x, top: pin.y }} title={note.comment} aria-label={`Feedback note ${numberOf(note.id)}: ${note.comment}`} onClick={() => edit(note, pin.x, pin.y + 20)}>{numberOf(note.id)}</button> : null;
    })}
    {composer ? <form className="fb-composer" data-testid="feedback-composer" style={{ left, top }} onSubmit={event => { event.preventDefault(); save(); }}>
      <p className="fb-target">{composer.target
        ? <><b>{composer.editId ? "Edit note" : "Comment on"}</b> {`<${composer.target.tag}>`}{composer.target.label ? ` “${composer.target.label}”` : ""}{composer.target.section ? <small>in {composer.target.section}</small> : null}</>
        : <b>{composer.editId ? "Edit general note" : "General note"}</b>}</p>
      {composer.selected ? <p className="fb-selected">Selected: “{composer.selected}”</p> : null}
      <textarea autoFocus aria-label="Your comment" placeholder="What should change here?" rows={4} value={composer.comment}
        onChange={event => setComposer({ ...composer, comment: event.target.value })}
        onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); } }} />
      <div className="fb-actions">
        <button type="button" className="fb-quiet" onClick={() => setComposer(null)}>Cancel</button>
        {composer.editId ? <button type="button" className="fb-quiet fb-danger" onClick={() => { update({ notes: notes.filter(note => note.id !== composer.editId) }); setComposer(null); }}>Delete</button> : null}
        <button type="submit" className="fb-primary" disabled={!composer.comment.trim()}>Save note</button>
      </div>
    </form> : null}
    {panel ? <aside className="fb-panel" aria-label="Feedback notes" data-testid="feedback-panel">
      <header><strong>Feedback notes ({notes.length})</strong><button type="button" className="fb-quiet" aria-label="Close notes" onClick={() => setPanel(false)}><CloseIcon /></button></header>
      {notes.length ? <ol>
        {ordered.map(note => <li key={note.id}>
          <span className="fb-num">{numberOf(note.id)}</span>
          <div>
            <small>{note.path === "" ? "General" : note.path}{note.section ? ` · ${note.section}` : ""}{note.label ? ` · ${note.label}` : ""}</small>
            <p>{note.comment}</p>
            <div className="fb-row">
              {note.path && note.path !== path ? <a href={note.path}>Go to page</a> : null}
              <button type="button" className="fb-link" onClick={() => edit(note, window.innerWidth - 700, 120)}>Edit</button>
              <button type="button" className="fb-link fb-danger" onClick={() => update({ notes: notes.filter(item => item.id !== note.id) })}>Delete</button>
            </div>
          </div>
        </li>)}
      </ol> : <p className="fb-empty">No notes yet. Right-click anything on a page to add one.</p>}
      {notes.length ? <>
        <label className="fb-label" htmlFor="fb-prompt">Prompt for Claude</label>
        <textarea id="fb-prompt" className="fb-prompt" readOnly value={prompt} data-testid="feedback-prompt" onFocus={event => event.currentTarget.select()} />
        <p className="fb-note">Notes stay in this browser. The prompt holds page, section, control labels and your words — never the text of ordinary page content unless you selected it.</p>
      </> : null}
      <footer>
        <button type="button" className="fb-quiet" onClick={() => { setPanel(false); setComposer({ x: window.innerWidth - 400, y: 120, target: null, selected: "", comment: "" }); }}>Add general note</button>
        <button type="button" className="fb-quiet fb-danger" disabled={!notes.length} onClick={clearAll}>Clear all</button>
        <button type="button" className="fb-primary" data-testid="feedback-copy" disabled={!notes.length} onClick={copy}>{copied ? "Copied" : "Copy prompt"}</button>
      </footer>
    </aside> : null}
    <div className="fb-dock" role="toolbar" aria-label="Feedback tools">
      <button type="button" className="fb-tool" data-testid="feedback-browse" aria-pressed={!annotating} aria-label="Browse: move around the app normally" title="Browse — move around the app normally" onClick={() => { update({ tool: "browse" }); setComposer(null); }}><CursorIcon /></button>
      <button type="button" className="fb-tool" data-testid="feedback-annotate" aria-pressed={annotating} aria-label="Annotate: click or right-click anything to comment" title="Annotate — click or right-click anything to comment" onClick={() => update({ tool: "annotate" })}><PencilIcon /></button>
      <span className="fb-hint" role="status">{annotating ? "Annotate · click or right-click anything" : "Browse · the app works as normal"}</span>
      <button type="button" className="fb-quiet" data-testid="feedback-review" onClick={() => setPanel(!panel)}>{notes.length ? `Review & copy (${notes.length})` : "Notes"}</button>
      <button type="button" className="fb-quiet" onClick={() => update({ on: false })}>Turn off</button>
    </div>
  </div>;
}
