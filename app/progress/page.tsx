"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export default function BuildProgress() {
  const [data, setData] = useState<{
    updated: string;
    stages: { name: string; status: string }[];
  } | null>(null);
  useEffect(() => {
    const read = () =>
      fetch("/build-progress.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((v) =>
          setData(
            v as {
              updated: string;
              stages: { name: string; status: string }[];
            },
          ),
        )
        .catch(() => {});
    void read();
    const t = setInterval(read, 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="document-page">
      <Link href="/">← Back to Atlas</Link>
      <h1>Atlas build progress</h1>
      <p>This page refreshes while the app takes shape.</p>
      <p>
        The current comparison uses monday.com’s published work-management
        workflows. Atlas now covers the selected planning and leadership
        workflows; it does not claim full monday.com parity.
      </p>
      <p>
        <a
          href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/MONDAY-WORK-MANAGEMENT-AUDIT.md"
          target="_blank"
          rel="noreferrer"
        >
          Feature comparison and remaining gaps ↗
        </a>
      </p>
      {data?.stages.map((s) => (
        <div className="progress-stage" key={s.name}>
          <span>{s.name}</span>
          <strong>{s.status}</strong>
        </div>
      ))}
      <p style={{ marginTop: 25 }}>
        Last update: {data?.updated || "Loading…"}
      </p>
    </main>
  );
}
