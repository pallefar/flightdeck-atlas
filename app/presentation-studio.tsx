"use client";
import { useEffect, useState } from "react";
import {
  Presentation,
  Plus,
  Download,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createDeck, templates, type Deck } from "@/lib/presentations";
import { useT } from "@/lib/i18n/react";
import type { Project } from "@/lib/projects";
async function fetchDecks(offset: number, scopedProjectId?: string) {
  const r = await fetch(
      "/api/decks?offset=" +
        offset +
        (scopedProjectId
          ? "&project=" + encodeURIComponent(scopedProjectId)
          : ""),
    ),
    b = (await r.json()) as {
      error: string;
      deck: Deck;
      decks: Deck[];
      nextOffset: number | null;
    };
  if (!r.ok) throw Error(b.error);
  return b;
}
export default function PresentationStudio({
  projects,
  demo,
  initialProjectId,
  scopedProjectId,
}: {
  scopedProjectId?: string;
  projects: Project[];
  demo: boolean;
  initialProjectId?: string | null;
}) {
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]),
    [deck, setDeck] = useState<Deck | null>(null),
    [ids, setIds] = useState<string[]>(
      initialProjectId ? [initialProjectId] : [],
    ),
    [template, setTemplate] = useState<Deck["template"]>("Leadership update"),
    [audience, setAudience] = useState("Leadership team"),
    [period, setPeriod] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [slide, setSlide] = useState(0),
    [present, setPresent] = useState(false),
    [dirty, setDirty] = useState(false),
    [exportNote, setExportNote] = useState("");
  const tr = useT();
  async function load(offset = 0) {
    try {
      const b = await fetchDecks(offset, scopedProjectId);
      setDecks((old) => (offset ? [...old, ...b.decks] : b.decks));
      setNextOffset(b.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    fetchDecks(0, scopedProjectId).then(
      (b) => {
        setDecks(b.decks);
        setNextOffset(b.nextOffset);
      },
      (e) => setError((e as Error).message),
    );
  }, [scopedProjectId]);
  useEffect(() => {
    if (!present) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresent(false);
      if (e.key === "ArrowRight")
        setSlide((i) => Math.min((deck?.slides.length || 1) - 1, i + 1));
      if (e.key === "ArrowLeft") setSlide((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [present, deck?.slides.length]);
  function change(next: Deck) {
    setDeck(next);
    setDirty(true);
  }
  async function save() {
    if (!deck) return null;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/decks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: deck.id || undefined,
            revision: deck.revision,
            data: deck,
          }),
        }),
        b = (await r.json()) as {
          error: string;
          deck: Deck;
          decks: Deck[];
          nextOffset: number | null;
        };
      if (!r.ok) throw Error(b.error);
      setDeck(b.deck);
      setDirty(false);
      await load();
      return b.deck as Deck;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function exportDeck() {
    const saved = dirty || !deck?.id ? await save() : deck;
    if (!saved) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/decks?id=${encodeURIComponent(saved.id)}`),
        b = (await r.json()) as {
          error: string;
          deck: Deck;
          decks: Deck[];
          nextOffset: number | null;
        };
      if (!r.ok) throw Error(b.error);
      const d = b.deck as Deck;
      const { default: PptxGenJS } = await import("pptxgenjs");
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "FlightDeck Atlas";
      pptx.subject = d.template;
      pptx.title = d.title;
      pptx.company = "TE Connectivity";
      const logo = await fetch("/te-logo.png")
        .then((r) => r.blob())
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }),
        );
      d.slides.forEach((s, i) => {
        const page = pptx.addSlide();
        page.background = { color: "F5F7F8" };
        page.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: 0.17,
          h: 7.5,
          fill: { color: "E98300" },
          line: { color: "E98300" },
        });
        page.addImage({ data: logo, x: 11.4, y: 0.35, w: 1.35, h: 0.7 });
        page.addText(s.title, {
          x: 0.65,
          y: 0.6,
          w: 10.3,
          h: 0.9,
          fontFace: "Aptos Display",
          fontSize: 28,
          bold: true,
          color: "2E4957",
          breakLine: false,
          fit: "shrink",
        });
        page.addText(s.body, {
          x: 0.7,
          y: 1.85,
          w: 11.8,
          h: 4.65,
          fontFace: "Aptos",
          fontSize: 19,
          color: "2E4957",
          valign: "top",
          breakLine: false,
          fit: "shrink",
          paraSpaceAfter: 12,
        });
        page.addText(
          `${d.period || "Saved project snapshot"}  ·  ${d.audience}  |  ${i + 1} / ${d.slides.length}`,
          { x: 0.7, y: 7.02, w: 11.8, h: 0.2, fontSize: 10, color: "637A87" },
        );
        page.addNotes(
          s.notes ||
            "Generated from Atlas. Verify source freshness before presenting.",
        );
      });
      await pptx.writeFile({
        fileName: `${d.title.replace(/[^a-z0-9 -]/gi, "") || "Atlas presentation"}.pptx`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Owner-only export for the FlightDeck import (/api/decks/export): the file
  // holds only the caller's own decks whose source projects are still
  // readable; the rest are reported as withheld, by id.
  async function exportAll() {
    setBusy(true);
    setError("");
    setExportNote("");
    try {
      const r = await fetch("/api/decks/export");
      if (!r.ok) throw Error(tr("decks.export.failed"));
      const b = (await r.json()) as {
        decks: unknown[];
        withheld: unknown[];
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `atlas-presentations-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNote(
        [
          tr("decks.export.done", { count: b.decks.length }),
          b.withheld.length
            ? tr("decks.export.withheld", { count: b.withheld.length })
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch {
      setError(tr("decks.export.failed"));
    } finally {
      setBusy(false);
    }
  }
  const current = deck?.slides[Math.min(slide, (deck?.slides.length || 1) - 1)];
  return (
    <main
      className={`hub-page suite-page ${present ? "presentation-fullscreen" : ""}`}
    >
      <div className="suite-heading">
        <div>
          <span className="eyebrow">PRESENTATION STUDIO</span>
          <h1>Make the work visible.</h1>
          <p>Build an editable TE presentation from your selected projects.</p>
        </div>
        <Presentation size={32} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!deck ? (
        <>
          <section className="suite-card">
            <h2>Create a presentation</h2>
            <fieldset disabled={busy || demo}>
              <div className="suite-form-grid">
                <label>
                  Template
                  <select
                    value={template}
                    onChange={(e) =>
                      setTemplate(e.target.value as Deck["template"])
                    }
                  >
                    {templates.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Audience
                  <Input
                    maxLength={100}
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  />
                </label>
                <label>
                  Reporting period
                  <Input
                    maxLength={100}
                    placeholder="e.g. September 2026"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  />
                </label>
              </div>
              <div className="suite-project-picker">
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={ids.includes(p.id)}
                        onChange={(e) =>
                          setIds(
                            e.target.checked
                              ? [...ids, p.id]
                              : ids.filter((x) => x !== p.id),
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))}
              </div>
              <Button
                disabled={!ids.length || ids.length > 15}
                onClick={() => {
                  setDeck({
                    ...createDeck(
                      projects.filter((p) => ids.includes(p.id)),
                      template,
                      audience,
                      period,
                    ),
                    id: crypto.randomUUID(),
                    revision: 0,
                    updatedAt: new Date().toISOString(),
                    canEdit: true,
                  });
                  setSlide(0);
                  setDirty(true);
                }}
              >
                Create outline
              </Button>
            </fieldset>
            {demo && <p>Create your own project to build a presentation.</p>}
            <p className="hub-muted">
              Uses saved project data and editable templates. AI narrative
              drafting awaits FlightDeck.{" "}
              {scopedProjectId
                ? "This workspace uses the selected project."
                : "Select up to 15 projects."}
            </p>
          </section>
          <section>
            <h2>
              {scopedProjectId
                ? "Presentations for this project"
                : "Saved presentations"}
            </h2>
            <div className="studio-toolbar">
              <Button
                variant="outline"
                disabled={busy || demo}
                onClick={() => void exportAll()}
              >
                <Download size={15} />
                {tr("decks.export.button")}
              </Button>
            </div>
            <p className="hub-muted">{tr("decks.export.hint")}</p>
            {exportNote && (
              <p className="hub-muted" role="status">
                {exportNote}
              </p>
            )}
            <div className="suite-card-grid">
              {decks.map((d) => (
                <button
                  className="suite-card"
                  key={d.id}
                  onClick={() => {
                    setDeck(d);
                    setSlide(0);
                    setDirty(false);
                  }}
                >
                  <Presentation />
                  <h3>{d.title}</h3>
                  <p>
                    {d.slides.length} slides ·{" "}
                    {d.shared
                      ? "Shared with source-project members"
                      : "Private"}
                  </p>
                  <small>{new Date(d.updatedAt).toLocaleString()}</small>
                </button>
              ))}
            </div>
            {nextOffset !== null && (
              <Button variant="outline" onClick={() => void load(nextOffset)}>
                Load more presentations
              </Button>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="studio-toolbar">
            <Button
              variant="outline"
              onClick={() => {
                if (dirty && !confirm("Discard unsaved presentation changes?"))
                  return;
                setDeck(null);
                setPresent(false);
              }}
            >
              Back to presentations
            </Button>
            {deck.canEdit && (
              <Button disabled={busy} onClick={() => void save()}>
                {dirty ? "Save changes" : "Saved"}
              </Button>
            )}
            <Button disabled={busy} onClick={() => void exportDeck()}>
              <Download size={15} />
              Export PowerPoint
            </Button>
            <Button variant="outline" onClick={() => setPresent(!present)}>
              {present ? "Exit presentation" : "Present"}
            </Button>
          </div>
          {!present && (
            <>
              <div className="suite-form-grid">
                <label>
                  Presentation title
                  <Input
                    disabled={!deck.canEdit || busy}
                    maxLength={120}
                    value={deck.title}
                    onChange={(e) => change({ ...deck, title: e.target.value })}
                  />
                </label>
                <label>
                  Sharing
                  <select
                    disabled={!deck.canEdit || busy}
                    value={deck.shared ? "shared" : "private"}
                    onChange={(e) =>
                      change({ ...deck, shared: e.target.value === "shared" })
                    }
                  >
                    <option value="private">Private to me</option>
                    <option value="shared">
                      Members with access to every source project
                    </option>
                  </select>
                </label>
              </div>
              <p className="hub-muted">
                Source snapshot:{" "}
                {deck.snapshots
                  .map(
                    (s) => `${s.name} (${new Date(s.at).toLocaleDateString()})`,
                  )
                  .join(" · ")}
                {deck.snapshots.some(
                  (s) =>
                    projects.find((p) => p.id === s.id)?.revision !==
                    s.revision,
                )
                  ? " · Sources have changed since this outline was created."
                  : ""}
              </p>
            </>
          )}
          <div className="studio-layout">
            {!present && (
              <aside className="slide-list">
                {deck.slides.map((s, i) => (
                  <button
                    key={s.id}
                    aria-pressed={slide === i}
                    onClick={() => setSlide(i)}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {s.title}
                  </button>
                ))}
                {deck.canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      change({
                        ...deck,
                        slides: [
                          ...deck.slides,
                          {
                            id: crypto.randomUUID(),
                            title: "New slide",
                            body: "",
                            notes: "",
                          },
                        ],
                      });
                      setSlide(deck.slides.length);
                    }}
                  >
                    <Plus size={15} />
                    Add slide
                  </Button>
                )}
              </aside>
            )}
            <div>
              {current && (
                <>
                  <article className="slide-preview">
                    <img src="/te-logo.png" alt="TE Connectivity" />
                    <span className="eyebrow">{deck.template}</span>
                    <h2>{current.title}</h2>
                    <p>{current.body}</p>
                    <footer>
                      {deck.audience} · {deck.period || "Saved snapshot"}
                      <span>
                        {slide + 1} / {deck.slides.length}
                      </span>
                    </footer>
                  </article>
                  {present ? (
                    <div className="suite-actions">
                      <Button
                        disabled={slide === 0}
                        onClick={() => setSlide(slide - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        disabled={slide >= deck.slides.length - 1}
                        onClick={() => setSlide(slide + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  ) : (
                    deck.canEdit && (
                      <fieldset
                        className="suite-card slide-editor"
                        disabled={busy}
                      >
                        <label>
                          Slide title
                          <Input
                            maxLength={160}
                            value={current.title}
                            onChange={(e) =>
                              change({
                                ...deck,
                                slides: deck.slides.map((s) =>
                                  s.id === current.id
                                    ? { ...s, title: e.target.value }
                                    : s,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Slide content
                          <Textarea
                            maxLength={5000}
                            value={current.body}
                            onChange={(e) =>
                              change({
                                ...deck,
                                slides: deck.slides.map((s) =>
                                  s.id === current.id
                                    ? { ...s, body: e.target.value }
                                    : s,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Speaker notes & evidence
                          <Textarea
                            maxLength={2000}
                            value={current.notes}
                            onChange={(e) =>
                              change({
                                ...deck,
                                slides: deck.slides.map((s) =>
                                  s.id === current.id
                                    ? { ...s, notes: e.target.value }
                                    : s,
                                ),
                              })
                            }
                          />
                        </label>
                        <div className="suite-actions">
                          {[-1, 1].map((delta) => (
                            <Button
                              key={delta}
                              variant="outline"
                              disabled={
                                slide + delta < 0 ||
                                slide + delta >= deck.slides.length
                              }
                              onClick={() => {
                                const slides = [...deck.slides];
                                [slides[slide], slides[slide + delta]] = [
                                  slides[slide + delta],
                                  slides[slide],
                                ];
                                change({ ...deck, slides });
                                setSlide(slide + delta);
                              }}
                            >
                              {delta < 0 ? (
                                <ArrowUp size={14} />
                              ) : (
                                <ArrowDown size={14} />
                              )}
                              Move {delta < 0 ? "up" : "down"}
                            </Button>
                          ))}
                          <Button
                            variant="outline"
                            disabled={deck.slides.length < 2}
                            onClick={() => {
                              change({
                                ...deck,
                                slides: deck.slides.filter(
                                  (s) => s.id !== current.id,
                                ),
                              });
                              setSlide(Math.max(0, slide - 1));
                            }}
                          >
                            <Trash2 size={14} />
                            Remove slide
                          </Button>
                        </div>
                      </fieldset>
                    )
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
