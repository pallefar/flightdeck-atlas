# Where the suite's URLs come from (and where they are not)

Searched 2026-10-30, because Atlas must not guess a URL:

| Where | What was found |
|---|---|
| `project-contract` (contracts) | no app deployment URLs. The only real host is Atlas's own: `https://flightdeck-project-atlas.pallefar.chatgpt.site` |
| `project-contract/schema/*.json` | `$id`s are contract URIs (`https://flightdeck.local/schemas/...`), not app locations |
| `wt-central-updater/subapps.json` | a real registry, `subapp-registry/1`, with installed sub-app **ids**: `advantage`, `maps`, `docusign` — versions, scopes, enable state. **No URL field.** |
| `wt-central-updater/registry/` | registry.json, bands, countries, entities, sites — business registry, not app URLs |
| `wt-flightdeck-maps`, `wt-adv`, `wt-docs`, `wt-atlas-sync` | no deployment URL or `.env.example` base URL |

## What this means for Atlas

- The **identity** Atlas should use is the OS sub-app id: `advantage`, `maps` (and later `studio`,
  `vision`, `pdf` when they join `subapps.json`). Atlas already uses `teoa`, `pdf`, `maps`,
  `studio`, `vision` internally; the join key should be the sub-app id, so `teoa` → `advantage`.
- The **location** is not in these repos. It must come from one of: the deploy configuration
  (Cloudflare / Vercel project settings), the updater's feed, or a `subapps.json` that gains an
  `entry`/`baseUrl` field. Until one of those exists, `GET /api/suite` correctly reports
  "not configured".
- The cleanest place to add it is `subapps.json`: one `baseUrl` per install, next to `version`.
  Then Atlas joins its suite rows to that registry instead of reading five environment variables.

## The ask, precisely

Either
1. add `"baseUrl"` (and optionally `"entry": "/…?project={project}"`) to each `installs[]` entry in
   `wt-central-updater/subapps.json`, and tell me where Atlas can read that file or an API of it; or
2. set `ATLAS_TEOA_URL`, `ATLAS_PDF_URL`, `ATLAS_MAPS_URL`, `ATLAS_STUDIO_URL`, `ATLAS_VISION_URL`
   in the Atlas environment — the registry already reads them per project.

## The registration is prepared, not applied

`scripts/register-subapp.mjs` puts Atlas into `subapps.json` and is a **dry run by default**:

```
node scripts/register-subapp.mjs --registry ../wt-central-updater/subapps.json \
  --base-url https://<atlas-host> --version 1.0.1 [--write]
```

It adds one entry — `id: "atlas"`, `baseUrl`, `entry: "/?view=brain&project={project}"` — and a
second run is a no-op rather than a second Atlas. It refuses to run without a base URL, because a
guessed one is worse than none.

It has **not** been applied: on 2026-10-30 the central-updater worktree was on `main` with three
uncommitted changes that are not mine (`host-a.txt`, `host-b.txt` deleted,
`scripts/studio-ship-guarded-branches.txt` modified). Sweeping those into a commit would be the
worst kind of help.
