"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Project } from "@/lib/projects";
import { scanProjects } from "@/lib/project-scan";
export type AtlasCommand = { id: string; label: string; run: () => void };
export default function CommandMenu({
  projects,
  onOpen,
  commands,
  disabled,
}: {
  projects: Project[];
  onOpen: (p: Project) => void;
  commands: AtlasCommand[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        !disabled &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        setQuery("");
        setOpen(true);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [disabled]);
  const results = scanProjects(projects, query, "all").slice(0, 12);
  const actions = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  function run(action: () => void) {
    setOpen(false);
    requestAnimationFrame(action);
  }
  return (
    <>
      <button
        ref={trigger}
        className="theme-toggle command-trigger"
        title="Search & commands (⌘K / Ctrl+K)"
        aria-label="Open search and commands"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <Search size={17} />
        <kbd>⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="command-dialog"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogTitle>Search & commands</DialogTitle>
          <DialogDescription>
            Find a project or jump to a workspace.
          </DialogDescription>
          <Input
            ref={input}
            aria-label="Search Atlas"
            placeholder="Projects, tasks, locations or commands…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div
            className="command-results"
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              const buttons = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              );
              const current = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              e.preventDefault();
              buttons[
                (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
              ]?.focus();
            }}
          >
            {!!actions.length && <h3>Go to</h3>}
            {actions.map((c) => (
              <button key={c.id} onClick={() => run(c.run)}>
                <span>{c.label}</span>
                <ArrowUpRight size={16} />
              </button>
            ))}
            {!!results.length && <h3>Projects</h3>}
            {results.map((p) => (
              <button key={p.id} onClick={() => run(() => onOpen(p))}>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.location || p.category} · {p.status}
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
            {!results.length && !actions.length && (
              <p>No matches. Try a project name, location or task.</p>
            )}
          </div>
          <small>
            Tab to results · ↑ ↓ to browse · Enter to open · Esc to close
          </small>
        </DialogContent>
      </Dialog>
    </>
  );
}
