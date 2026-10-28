# Atlas v1 — what is not built yet, and what it would take

Written at the end of the first build pass (2026-10-28). Every item here is a
real gap, not a limitation of the environment unless it says so. Nothing in
this file is a claim that something works.

## Hand-off transport (KG, DiagramForge, Studio, Companion)

- **State:** payload builders and the durable outbox are built and tested; the
  network call is not, and no live endpoint is faked.
- **Why:** each body is owned by another repository (`project-contract` for KG
  and Companion, `wt-flightdeck-maps`/DiagramForge for the map hand-off,
  `Flightdeck-code` for Studio). Sending without those endpoints would mean
  inventing them.
- **Next step:** in the owning repository, add the receive endpoint named in
  `docs/ONBOARDING-CONTRACTS.md`; then a transport module in
  `lib/onboarding/` calls `reserveHandoff` → `POST` → `observeHandoff`, with the
  reserved bytes and the same idempotency key on every retry.

## Windows client

- **State:** not started. No `atlas/windows` directory exists.
- **Why:** the owner question (Electron vs Tauri, PRD §14 Q1) is unanswered, and
  a shell built on a guess would be thrown away.
- **Next step:** decide Q1, then an Electron shell serving the existing web
  build plus a capture helper; the contract models are already generated, so the
  shell only needs the same fixtures to prove parity.

## macOS capture, transcription and sync

- **State:** the app shell, generated contract models and stage ladder are
  built, signed and installed. ScreenCaptureKit recording, on-device Whisper
  transcription and HTTPS sync are **not** built.
- **Why:** capture is the part of the PRD that needs the most care (permission
  prompts, a visible indicator, keyframe layout compatibility, no Cap). It was
  not attempted rather than half-built.
- **Next step:** a `Capture` target behind a protocol with a fake in tests, MP4 +
  keyframes in the Cap-compatible layout, scene detection merged with a fixed
  interval; then the sync client over the same endpoints the web lane uses.

## Evidence bytes

- **State:** the lane stores a hash, size and classification; the file itself is
  not uploaded anywhere.
- **Why:** evidence bytes belong in the OS docstore, and that upload does not
  exist in Atlas yet.
- **Next step:** a resumable upload to the docstore with the OS credential, then
  store `osRef` on the evidence row (the column exists).

## Realized value and Ask Atlas

- **State:** value records (baseline / 30 / 90 days, with a basis and a source)
  are built. Companion telemetry ingest and the "Ask Atlas" answerer are not.
- **Next step:** an aggregate, pseudonymous telemetry endpoint; a deterministic
  answerer that reads only permitted projects and cites `(projectId, stage, seq)`.

## Owner decisions still open

See `docs/DECISIONS-ATLAS-V1.md`: every row there is an assumption, not an
approval. The two that block the most work are the Windows shell (Q1) and
whether Atlas stays on Cloudflare Sites for TE data (Q3).
