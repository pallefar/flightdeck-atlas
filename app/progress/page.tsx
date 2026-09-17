"use client";
import { useEffect, useState } from "react";
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
      <a href="/">← Back to Atlas</a>
      <h1>Atlas build progress</h1>
      <p>This page refreshes while the app takes shape.</p>
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
