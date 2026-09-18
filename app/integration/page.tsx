export default function Integration() {
  return (
    <main className="document-page">
      <a href="/?view=connection">← Back to connections</a>
      <h1>Ready for the FlightDeck SDK</h1>
      <p>
        Atlas stores your projects and tasks now. FlightDeck is not deployed
        yet, so shared sign-in and project synchronization are pending the new
        SDK. The current OS source has been reviewed and a typed project reader
        is prepared for its authenticated transport.
      </p>
      <h2>What the SDK needs to provide</h2>
      <ul>
        <li>
          An Atlas app registration, SDK version, host URL, allowed callback
          origins, and a return-to-app flow.
        </li>
        <li>
          Delegated sign-in across separate hosts, including session refresh,
          logout, revocation, and account switching. A host cookie alone cannot
          sign users into a different hostname.
        </li>
        <li>
          Authenticated identity, workspace discovery, and project reads with
          server-enforced membership and a documented project-read permission.
        </li>
        <li>
          Stable workspace and project IDs, update revisions, and an incremental
          update/deletion contract. Atlas will preserve the workspace/project
          pair when importing projects.
        </li>
        <li>
          A sub-app launch contract with workspace/project context, deep links,
          theme and session events, plus a test environment for the complete
          flow.
        </li>
      </ul>
      <h2>Master app and TEOA Advantage</h2>
      <p>
        Atlas now manages local users, roles, actions, and onboarding pilots.
        The SDK must connect verified users to explicit Atlas grants, then
        provide permitted Advantage summaries and context-aware launch. Atlas
        roles do not expand access inside FlightDeck.
      </p>
      <p>
        <a href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/MASTER-APP-CONTRACT.md">
          Read the master-app, roles, and Advantage contract ↗
        </a>
      </p>
      <h2>Projects in both directions</h2>
      <p>
        Connections now includes an OS intake list and saved Atlas onboarding
        drafts. When the SDK is connected, you will be able to create an Atlas
        counterpart for an accessible OS project, or create an OS project from a
        reviewed Atlas draft.
      </p>
      <p>
        The SDK needs scoped project creation, stable instance/workspace/project
        references, and durable idempotent operations. Live imports also require
        per-project access checks across Atlas so importing a project never
        expands who can see its OS data.
      </p>
      <p>
        <a href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/PROJECT-BRIDGE-CONTRACT.md">
          Read the project bridge contract and acceptance checks ↗
        </a>
      </p>
      <h2>Strategy, KPIs and your AI advisor</h2>
      <p>
        Atlas now supports manual goals and KPI measurements, richer tasks, a
        daily plan, and rule-based watch-outs. FlightDeck remains the selected
        AI provider; no project data is sent to an AI service yet.
      </p>
      <p>
        The SDK needs permission-scoped strategy and KPI reads with units,
        periods, timestamps, missing-data states, TEOA provenance and source
        links. AI reviews need authorized project snapshots, evidence-linked
        recommendations, and draft actions that you approve before they change
        anything.
      </p>
      <p>
        <a href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/STRATEGY-AI-CONTRACT.md">
          Read the strategy, KPI and AI handoff ↗
        </a>
      </p>
      <h2>Teams, apps and presentation creation</h2>
      <p>
        Atlas now has private project sharing, teams, discussions, review
        requests, attachments, recurring tasks, capacity planning and a TE
        presentation studio with PowerPoint export. The Apps launcher and Super
        Admin registry are ready for your other applications.
      </p>
      <p>
        Shared sign-in needs registered app origins and delegated sessions. The
        SDK must also define team membership, source ownership, revocation
        events and authorized collaboration writes. FlightDeck AI will supply
        draft recommendations and narratives once connected.
      </p>
      <p>
        <a href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/COLLABORATION-AND-APPS.md">
          Read the collaboration and app ecosystem handoff ↗
        </a>
      </p>
      <h2>What Atlas owns</h2>
      <p>
        Locations, descriptions, tasks, deadlines, and progress remain Atlas
        enrichment. The current OS project list supplies the source identity and
        label; it does not yet supply these richer project fields. Future SDK
        writes can extend this boundary once field ownership is agreed.
      </p>
      <h2>Before we enable the connection</h2>
      <p>
        We will verify that a FlightDeck session opens Atlas without another
        credential prompt, membership changes block access immediately, repeated
        sync preserves Atlas data, and project links retain the right workspace.
        The private preview currently uses its hosting platform’s sign-in.
      </p>
      <p>
        <a href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/FLIGHTDECK-SDK-REQUIREMENTS.md">
          Read the SDK handoff and acceptance checks ↗
        </a>
      </p>
    </main>
  );
}
