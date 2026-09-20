"use client";
import { useState } from "react";
import { ArrowUpRight, Search, BookOpen, CircleHelp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { workTools, type View, type WorkTool } from "@/lib/navigation";
export default function HelpCenter({
  navigate,
}: {
  navigate: (view: View, tool?: WorkTool) => void;
}) {
  const [query, setQuery] = useState("");
  const guides = [
    {
      title: "Plan your day · Eat the Frog",
      group: "Getting started",
      help: "Open Today & advisor, choose the most important difficult task as your frog, reserve focus time and start the timer. Capture other work in the task list and review the evidence-based watch-outs.",
      view: "today" as View,
    },
    {
      title: "Explore with Project Eye",
      group: "Getting started",
      help: "Use the top Project Eye tab for the globe. Projects need coordinates to appear on the map. Search your projects, select a marker and zoom into a workspace. Use Project Eye settings in the top bar to adjust layers, visual effects and motion.",
      view: "globe" as View,
    },
    ...workTools.map((t) => ({ ...t, view: "manage" as View, tool: t.id })),
    {
      title: "Share a project & collaborate",
      group: "Teamwork",
      help: "Open Project details, then Collaborate & share to manage project access, discussions and files. Atlas access must first be granted by the Super Admin. A copied URL does not grant access. Team workspace holds your inbox, teams and capacity.",
      view: "team" as View,
    },
    {
      title: "Create a slide deck",
      group: "Teamwork",
      help: "Open Presentations, choose your project and prepare an editable project update. Review the content, adjust the slides and export your deck. Keep project data current for accurate reporting.",
      view: "presentations" as View,
    },
    {
      title: "Focus, breaks & wellbeing",
      group: "Personal workspace",
      help: "Open Wellbeing to check in with your mood and readiness, set a focus session and plan breaks. Personal check-ins are not a clinical assessment. The top bar focus badge opens the active timer.",
      view: "wellbeing" as View,
    },
    {
      title: "FlightDeck OS connection",
      group: "Connections",
      help: "The connector is prepared for FlightDeck OS. Shared sign-in, OS projects, TEOA, strategy/KPIs and live AI depend on the OS SDK and API becoming available. Local Atlas projects and rule-based reviews work now.",
      view: "connection" as View,
    },
  ];
  const results = guides.filter((g) =>
    `${g.title} ${g.help} ${g.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <main className="help-center management-page">
      <header className="management-heading">
        <div>
          <span className="eyebrow">ATLAS FIELD GUIDE</span>
          <h1>Find your next move.</h1>
          <p>Learn the tools, follow a workflow, get back to your work.</p>
        </div>
        <BookOpen size={32} />
      </header>
      <div className="help-search">
        <Search size={20} />
        <Input
          aria-label="Search help"
          placeholder="Search Kanban, CEO, sharing, focus…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {!query && (
        <div className="help-start">
          <h2>New to Atlas? Start here.</h2>
          <ol>
            <li>
              Create a project with the top <strong>New project</strong> button.
            </li>
            <li>
              Select a project in the portfolio. Its menus appear in the
              sidebar; open{" "}
              <strong>Project management → Tasks & subtasks</strong>.
            </li>
            <li>
              Move its tasks through the <strong>Kanban board</strong>, then
              open a <strong>Leadership</strong> review. Use{" "}
              <strong>Back to all projects</strong> to return to the portfolio.
            </li>
          </ol>
          <p>
            <CircleHelp size={16} /> Hover, focus or tap a question-mark icon
            for a quick explanation. Use ⌘K or Ctrl+K to search and jump
            anywhere.
          </p>
        </div>
      )}
      <p className="help-result-count" role="status">
        {results.length} {results.length === 1 ? "guide" : "guides"}
        {query ? ` matching “${query}”` : " to explore"}
      </p>
      <div className="help-guides">
        {results.map((g) => (
          <article key={g.title}>
            <span className="eyebrow">{g.group}</span>
            <h2>{g.title}</h2>
            <p>{g.help}</p>
            <button
              onClick={() => navigate(g.view, "tool" in g ? g.tool : undefined)}
            >
              Open {g.title.split(" · ")[0]}
              <ArrowUpRight size={16} />
            </button>
          </article>
        ))}
      </div>
      {!results.length && (
        <div className="management-empty">
          <h2>No guide found</h2>
          <p>Try a tool name such as tasks, reports, sharing or timer.</p>
          <button onClick={() => setQuery("")}>Show all guides</button>
        </div>
      )}
    </main>
  );
}
