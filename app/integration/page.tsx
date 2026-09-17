export default function Integration() {
  return (
    <main className="document-page">
      <a href="/?view=connection">← Back to connections</a>
      <h1>Ready for the FlightDeck SDK</h1>
      <p>
        Atlas stores your projects and tasks now. FlightDeck is not deployed yet,
        so shared sign-in and project synchronization are pending the new SDK.
        The current OS source has been reviewed and a typed project reader is
        prepared for its authenticated transport.
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
          theme and session events, plus a test environment for the complete flow.
        </li>
      </ul>
      <h2>What Atlas owns</h2>
      <p>
        Locations, descriptions, tasks, deadlines, and progress remain Atlas
        enrichment. The current OS project list supplies the source identity
        and label; it does not yet supply these richer project fields. Future
        SDK writes can extend this boundary once field ownership is agreed.
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
