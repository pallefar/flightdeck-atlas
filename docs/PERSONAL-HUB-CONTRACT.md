# Personal wellbeing and Microsoft 365 hub

## Available now

- Dashboard mood control, self-reported readiness and a Pomodoro timer; full Wellbeing page for daily check-in, habits, original daily reflection and timer preferences.
- Readiness is the rounded mean of three self-ratings (rest, energy, clarity, 1–5), divided by 5 and multiplied by 100. All three inputs are required. Mood is separate. This is a personal reflection, not a clinical assessment, employee evaluation or inferred health status.
- Check-ins, habits, preferences and timer state are browser-local, under the authenticated Atlas user ID. They are never written to shared project APIs, sent to AI, or shown to team admins. Browser storage is not encrypted or a device security boundary. Clearing personal data resets the timer and check-in for this browser.
- A new local day resets ratings, mood, habits and completed-session count. Timer preferences and any running timer continue. The long-break cycle uses today's completed focus-session count. An expired timer discovered on a later day is not counted as a session today and resets to an idle focus timer.
- Pomodoro uses a wall-clock deadline, with pause/resume/reset and configurable focus/short/long lengths. Focus completion offers a break; four completed focus sessions offer a long break. The next session starts only on a user action. Cross-tab storage events synchronize state.
- Reminders are in-app only, when Atlas is open or on return. No operating-system notification, email, scheduled job or closed-browser alarm is configured.
- The dashboard widget can be hidden in Settings without losing its data or stopping a running timer.

## Outlook: prepared UI, no live connection

The dashboard and Wellbeing page show explicit disconnected states for Outlook email and calendar. Setup opens the connection requirements; it does not simulate authentication. No mailbox or calendar is read, no summary generated, and no meeting created.

Before implementation, provide an approved Microsoft Entra app registration and tenant policy, client ID, a registered callback on the deployed Atlas origin, and a secure server-side credential/token store. Do not put refresh tokens, client secrets or Graph tokens in browser storage. Bind the Microsoft tenant/subject to the verified Atlas account; support disconnect, expiry, revocation and account switching.

Use a delegated read connection scoped to the signed-in user's mailbox/calendar. Microsoft's basic message permission is `Mail.ReadBasic`; reading bodies for summaries needs the appropriate additional permission and explicit product consent. See [list messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0) and the [permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference#mailreadbasic).

For upcoming events, `calendarView` returns instances and exceptions for a bounded time range and supports delegated `Calendars.ReadBasic`. Handle timezone offsets, all-day events, cancelled meetings and pagination. See [Microsoft calendarView documentation](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0).

Proposed first connected dashboard:

1. Upcoming meetings with local times and links back to Outlook.
2. Selected-folder email priorities and follow-ups, each linked to its source thread and labeled with refresh time.
3. Available focus windows computed from the chosen calendar and working hours. Suggestions do not book meetings.
4. Reviewable actions the user can deliberately turn into Atlas tasks. Do not send email, RSVP, move meetings or create tasks automatically.

Start with deterministic lists. Before AI summarization, agree the approved model/data processor, selected folders, retention, exclusion rules and user consent. Treat email bodies as untrusted data; embedded instructions must never trigger actions. Missing access/data is not an empty inbox or free calendar.

Personal mail and calendar results must never enter shared project lists, shared briefings or AI feeds without a deliberate, authorized user action. Atlas admin roles do not grant mailbox access. Default to no persistent message bodies and minimum metadata caching.

## Verification before connection launch

- Two users cannot access each other's Outlook data or tokens. Account switch clears stale results.
- Revoked or expired access fails closed and prompts reconnection without fabricated summaries.
- Pagination and timezones preserve event/message identity; partial responses disclose coverage.
- Every summary links back to its evidence. No source content is treated as executable instructions.
- Disconnect removes cached private data and delegated credentials; no background write actions occur.
