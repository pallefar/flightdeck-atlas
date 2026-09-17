# FlightDeck Atlas

A TE Connectivity themed project workspace with a dashboard and a Cesium-based God’s Eye globe.

## Included

- Project creation and editing, task completion, progress and location metadata.
- Durable project records in D1, protected server-side by authenticated user identity.
- Shared project state between the dashboard and the globe.
- Globe → building → stylized 3D room → laptop → project journey, with skip, cancel and reduced-motion support.
- Light and dark themes with a remembered device preference.
- FlightDeck DTO validation, an injectable SDK transport, and an integration handoff. **Live FlightDeck SSO and sync are pending the new SDK.**
- A clearly labeled example workspace until you add your own projects.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run db:generate # only if the schema changes
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_brave_vector.sql
npm run dev
```

Apply the initial migration once per local database. `npm run dev` prints the local URL. The bundled local sign-in flow supplies a development-only identity on loopback. Production identity comes from the private hosting dispatcher; do not expose a bare Worker that trusts arbitrary identity headers.

```sh
npx tsc --noEmit
npx playwright test
```

The browser tests use an already running local server at port 5173 and Chrome. They create and remove a temporary project. The SDK adapter tests use fixtures and do not contact FlightDeck.

## FlightDeck integration

See [SDK requirements](docs/FLIGHTDECK-SDK-REQUIREMENTS.md). The live connection is intentionally disabled until the new SDK provides delegated identity and authorized project transport. The private preview’s platform identity is not FlightDeck SSO.

## Map and motion

The globe uses Cesium, Esri satellite imagery, Re:Earth terrain, and community building footprints. These are external services with best-effort availability; a street-map fallback is provided. Building footprints are not photographic facades. Room interiors are a stylized Three.js scene, not real building interiors. Coordinates are supplied by the project author.

Cesium runtime assets are copied from the locked package into `public/cesium` before development/build and are not committed. Keep map provider attributions visible. The globe/camera approach follows God’s Eye View; the unrelated intelligence feeds and reference footage are not bundled.

TE branding uses the TE Connectivity logo already present in FlightDeck OS. The theme uses TE Orange (#E98300), Dark Teal (#2E4957), and complementary brand colors from TE’s published guidelines. See [third-party notices](THIRD_PARTY_NOTICES.md).
