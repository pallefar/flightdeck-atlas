# Atlas live cutover — 5 October 2026

The reviewed Atlas release is live at [FlightDeck Atlas](https://flightdeck-project-atlas.pallefar.chatgpt.site). The existing private Site, its D1/R2 data and its custom audience were preserved. This document records the live cutover; the [Vision implementation handover](HANDOVER-2026-10-05-VISION-OS.md) retains the earlier implementation and local validation history.

## Verified deployment

| Item | Final value |
| --- | --- |
| Site project | `appgprj_6aabb45cc9cc81918ed1d15419480f50` |
| Source commit | `20be0c2b8b42c39ad633b2525f986141accca343` |
| Saved version | **11** |
| Saved version ID | `appgprj_6aabb45cc9cc81918ed1d15419480f50~appgver_ac2541e4d44081919b1e0ce2a790fb6a` |
| Final deployment ID | `appgdep_6ac39b3e2b2c8191b037880d57df302e` |
| Native deployment status | `succeeded` |
| Environment revision | **2** |
| Final deployment time | `2026-10-05T12:42:59.264162+00:00` |
| Audience | `custom`, one allowed owner, no groups |
| Logical storage bindings | D1 `DB`, R2 `BUCKET` |

Existing-Site opening, production build, source push and archive packaging completed through the Sites workflow with the exact source commit above. Initial deployment `appgdep_6ac396bfb4b48191b92f3a72b47d0ae6` succeeded with environment revision 1; the same saved version was then redeployed with the browser-only launcher configuration. No source changes or replacement Site were required for that configuration change.

The archive contained the canonical generated migrations `0000` through `0013`. Sites applied the missing migrations to the existing D1 database. A read-only live table overview verified `atlas_flightdeck_operations`, `atlas_flightdeck_transitions`, `atlas_onboarding_metrics`, `atlas_project_links` and `atlas_vision_delivery_outbox` after deployment. No fixture database or seed data was imported, and neither D1 nor R2 was replaced. This verification confirms the deployed schema; it does not claim that real project synchronization has occurred.

The private machine record is `.shots/work/vision-atlas-live-deployment.json` in the outer FlightDeck OS folder, with owner-only file permissions. It contains deployment history and limitations, without credentials. It is not a Cloud dependency or a committed configuration source.

## Vision launcher and sign-in

The only added production runtime value is:

```text
ATLAS_FLIGHTDECK_VISION_URL=http://127.0.0.1:4173/console/vision?standalone=1
```

This is browser-only navigation to the OS running on the same Mac as the browser. It opens a new tab. The OS must be running on port 4173; on another machine, the link reaches that machine's own loopback instead. Set a deliberate browser-facing URL for another installation rather than copying this value unchanged.

The current URL validator explicitly accepts HTTP loopback and rejects URL credentials and non-local HTTP. No production validator or permission check was weakened. The reserved card requires a nonempty trusted Sites identity and one of the configured owner email identities; a general Atlas administrator receives no private card. The sole hosted Site owner was verified to match those configured identities without recording its email here. `ATLAS_SUPERADMIN_EMAIL` was preserved unchanged.

Atlas uses Sites sign-in. Vision OS separately requires an OS password session and its server-configured owner binding. The Atlas link neither forwards that session nor establishes OS ownership. Local OS accounts `karsten-gmail` and `karsten-te` are normal administrators, and both exact accounts are now bound to the private Vision owner gate. Live OS checks verified owner access through the normal authenticated session; no general administrator or super-administrator bypass was added.

The paired OS cutover completed **66 live verification checks** for owner binding, private bootstrap, source import and protected downloads. The verified private import contains **24 PDFs, 779 pages, 16 roadmap records and 6 portfolio records**. Download bytes and hashes were checked. These counts describe imported records; they are not completed initiatives, measured benefits or approved policy. Private source bytes remain in OS private data. Follow the latest OS live-cutover handover for its runtime and migration details. Owner access and successful import do not approve an assessment or activate an HR workspace/project.

## Hosted OS bridge remains pending

Production Atlas has **no** `ATLAS_FLIGHTDECK_URL` or `ATLAS_FLIGHTDECK_INBOUND_TOKEN` configured. A hosted Worker cannot reach the owner's Mac through `127.0.0.1`. The browser launcher therefore does not enable workspace/project context reads, project onboarding, assessment status reads or delivery status synchronization from hosted Atlas.

To connect the hosted bridge later:

1. Establish a stable authenticated OS origin reachable from the hosted Atlas server, or an approved private connection supported by the integration. Keep the OS session and private Vision APIs protected.
2. Mint the existing machine-scoped inbound credential with the approved readable workspaces. Vision delivery requires both `read:context` and `submit:proposal`; enable any intended project-onboarding kind through the OS's protected configuration.
3. Configure only the actual server origin and credential through Sites runtime settings, then redeploy a saved version to apply that environment revision. Keep credentials out of Git, browser responses, the hosting manifest and handover files.
4. Verify the OS instance and the confirmed installation/workspace/project tuple. A similarly named Atlas project is not a link. Review the existing installation ID before creating links; do not change it after links exist.
5. Verify denial before assessment approval, owner approval and technical activation, then a permitted delivery transition and acknowledged status synchronization using a disposable project. Preserve evidence and record each result before describing the bridge as live.

No cloud status synchronization or delegated single sign-on was verified in this cutover. The deployment does not activate HR workspaces/projects, approve assessments, confirm TE policy, set fiscal boundaries or establish measured benefits. Those remain evidence-backed OS decisions and configuration.

## Continue from another Mac or cloud session

Fetch the paired repositories and read this document before relying on the earlier implementation handover's historical statement that production migration was pending. The deployed source is the exact Atlas commit listed above; subsequent documentation commits may advance the Git branch without changing saved version 11.

Reuse the Site project and its current audience. Production deployment uses the Sites workflow and saved versions; do not deploy raw local Wrangler placeholder bindings or recreate the Site. The live D1 migrations are already applied: do not replay SQL blindly or regenerate destination migrations. Verify actual state before the next migration.

Restore machine-private configuration through the protected setup. Do not copy fixture `.env.local`, fixture D1, source credentials, local test outputs or the private Vision corpus into Atlas or Git. Read the paired OS handover for runtime ownership, account binding, private import verification and any remaining activation steps.
