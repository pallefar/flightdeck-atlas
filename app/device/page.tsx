"use client";

import { useEffect, useState } from "react";

// The browser half of the app's sign-in: the person is already signed in here,
// so approving is one button. The token never appears on this page — the app
// collects it.
export default function DevicePage() {
  const [code, setCode] = useState("");
  const [state, setState] = useState("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code") ?? "";
    setCode(fromUrl);
    if (!fromUrl) {
      setState("missing");
      return;
    }
    fetch(`/api/access/device-code?code=${encodeURIComponent(fromUrl)}`)
      .then(async (response) =>
        response.ok ? ((await response.json()) as { state?: string }) : { state: "unknown" },
      )
      .then((body) => setState(body.state ?? "unknown"))
      .catch(() => setState("unknown"));
  }, []);

  const approve = async () => {
    const response = await fetch("/api/access/device-code", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; email?: string };
    setMessage(
      response.ok
        ? `Approved for ${body.email ?? "you"}. Return to Atlas.`
        : (body.error ?? "That code could not be approved."),
    );
    if (response.ok) setState("approved");
  };

  return (
    <main className="device-page">
      <h1>Approve Atlas on this device</h1>
      {state === "missing" && <p>No code was given. Open the app and ask it to sign in again.</p>}
      {state === "checking" && <p>Checking the code…</p>}
      {state === "unknown" && <p>That code is not pending. Ask the app for a new one.</p>}
      {state === "expired" && <p>That code has expired. Ask the app for a new one.</p>}
      {state === "delivered" && <p>That code has already been used.</p>}
      {code && (state === "pending" || state === "approved") && (
        <>
          <p>
            The app is showing <strong>{code}</strong>. Approving signs it in as you, with your
            workspace roles.
          </p>
          {state === "pending" ? (
            <button type="button" onClick={() => void approve()}>
              Approve this device
            </button>
          ) : (
            <p role="status">{message || "Approved. Return to Atlas."}</p>
          )}
        </>
      )}
      <p className="device-note">
        The app receives a token, not your password. You can revoke it in the app&apos;s settings,
        and it expires if unused.
      </p>
    </main>
  );
}
