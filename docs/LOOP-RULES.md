# The rules every loop follows

These apply to **every** batch of improvements, not once:

1. **Look at the web version first.** Before an item is called done, the same
   journey is walked in the lane (`?view=brain`) and in the macOS app. If the two
   disagree — a field, a state, a word, a number — that is a bug in this batch,
   not a note.
2. **Integrate with the OS and the suite.** Every batch must move at least one
   integration: a hand-off to Studio, a deep link into Maps, Advantage, the PDF
   app or Vision, a shared identity, or data coming back from a run. Atlas is the
   front door, not the whole house.
3. **Never invent an endpoint or a URL.** The suite's URLs are configuration
   (`ATLAS_*_URL`); when one is unset the UI says so. A guessed id or path is a
   defect.
4. **Verify with tests on both surfaces**, then say plainly what was not
   verified. A test that only checks the happy path is not verification.
5. **Stop after five items** and present them for review.
6. **Push at the end of every batch**, and say what landed on origin. Nothing
   stays only on this machine.
7. **The same message must never be wiped by a refresh.** `open()` clears
   notices; write the notice after it, or pass it through `open()`.

## Feedback and updates follow the suite

- Feedback is the same overlay as FlightDeck Maps (annotate/browse, selector,
  label, section). In Atlas it is available to **every signed-in person**, as in
  Maps; the server relay (`atlas_feedback`) keeps what admins need for triage.
- Updates are served by `GET /api/app-updates`. When `ATLAS_UPDATE_FEED` names the
  central updater's feed, that feed is authoritative and the verdict says
  `source: "feed"`; an unreadable feed falls back to this deployment's
  `app-updates.json` and is marked `local_fallback`. A refused check still never
  says "up to date". The app shows the release's notes with its Download link.
