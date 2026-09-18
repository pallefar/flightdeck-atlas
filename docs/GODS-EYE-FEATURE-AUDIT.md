# God’s Eye reference and Atlas implementation

Reference reviewed: https://github.com/bilawalsidhu/gods-eye-view, main at 0d41b6be5490db1f10a171f238be75db4d4ec3b4 (18 September 2026). Atlas uses its existing Cesium/Three architecture; the reference's Node/Vite filesystem and WebSocket proxies cannot be deployed unchanged as this Worker.

## Implemented controls

- Seven display looks: Normal, CRT, Night vision, Thermal, Anime, Noir, Snow. Atlas-authored postprocessing includes gain, contrast, saturation, pixelation, scanlines, grain, vignette, CRT distortion/instability, thermal palettes/sensitivity and snow density/wind. Bloom and sharpening are adjustable. Night vision and thermal are simulated image effects, never actual heat measurements or hidden-scene sensing.
- HUD off/minimal/operator/tactical; project-data detection brackets with density, persistent circular scope with feather, clean view that preserves attribution and an exit, atmosphere, haze and render quality.
- Existing satellite/street imagery, terrain and community buildings, marker labels/risk colours, current/preset sunlight and shadows. Loading/fallback/degraded/unavailable source states are visible in Scenes.
- North-up and top-down/oblique controls, smooth zoom with circular lens, orbit speeds, terrain-aware project approach, manual stop, full-world reset and reduced-motion handling.
- Project briefing tours advance after flight completion and configurable dwell. Scene director stores account-private camera bookmarks and supports import/export and camera view links. Links do not grant project access.
- Private map annotations: pins, lines and areas, labels, five colours and clear. Stored in account preferences; they are annotations rather than surveyed boundaries.
- USGS reported earthquakes from the last 24 hours, refreshed every five minutes while enabled and visible, with event details and source links. Data failure is unavailable, not an empty successful result.
- Workspace transitions retain interactive 3D geometry, now with studio environment lighting, wood grain, softened shadows, rounded edges and smoother camera trajectories. The room/city are illustrative, not a model of a real project building.

## Not connected / additional dependencies

The settings inventory names flights/cockpit, satellites, AIS vessels, traffic, transit, bikeshare, public cameras, mapped camera locations, NASA FIRMS fires, launch schedules, routing, radio, infrastructure snapshots and voice. These do not load or claim live data. Each needs a reviewed provider adapter, current source terms, explicit provenance/freshness, request budgets, lifecycle cleanup and, where necessary, server credentials. FlightDeck remains the selected AI provider; the reference's OpenAI key flow is not substituted.

Google photorealistic 3D and ion-hosted map stacks need approved restricted map credentials and provider setup. Credentials are not collected in browser-local settings. A configured key must be distinguished from accepted, quota-limited, degraded and unavailable service.

The reference includes noncommercial datasets (TeleGeography submarine cables and Bhote Koshi imagery/derivatives); these are not bundled into the TE dashboard without separate permission. Reference demo media is not reused. Provider credits remain visible, including in clean view. See the reference LICENSE, DATA_SOURCES.md and docs/media/README.md. Atlas display-effect code was authored for this app; the reference was used as a feature inventory, not copied wholesale.
