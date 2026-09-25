// Durable Atlas notices for FlightDeck sends (plan 2026-09-25 J5,
// onb-atlas-notifications). One notice per recorded transition (lib/
// flightdeck/transitions.ts) for each recipient: the requester who asked the
// Super Admin to send (unless they withdrew the ask) and every Super Admin.
// The notices are written in the same D1 batch as the transition row, so a
// transition never exists without its notices, and a lost write of either is
// caught up by the next observation of the send. UNIQUE(send_id, seq,
// recipient) keeps one notice per recipient per transition.
//
// A notice holds a fixed sentence per stage and nothing else: never the
// reviewer's note (D-037 item 5), which stays on the send it came with.
// Access is not decided when the notice is written but each time it is read
// (noticesFor), so a recipient who can no longer view the project sees none
// of its notices.
import type { OnboardDb } from "./onboard-route";
import type { OnboardingStage } from "./onboarding";

export const NEEDS_CHANGES_TEXT = "Your FlightDeck request needs changes";

const TEXT: Record<OnboardingStage, string> = {
  "not-confirmed": "Your FlightDeck request was sent and awaits confirmation",
  submitted: "Your FlightDeck request was submitted",
  linked: "FlightDeck created the project for your request",
  "setup-in-progress": "FlightDeck setup started for your request",
  "setup-complete": "FlightDeck setup is complete for your request",
  "needs-more-info": NEEDS_CHANGES_TEXT,
  rejected: "Your FlightDeck request was declined",
  "not-sent": "Your FlightDeck request was not sent",
  closed: "Your FlightDeck request was closed",
};

/** The one sentence a transition's notice says. Fixed per stage. */
export const noticeText = (stage: OnboardingStage) => TEXT[stage];

/** Who a transition notifies, besides the Super Admin members in D1: the
 * configured Super Admin sign-in(s) (ATLAS_SUPERADMIN_EMAIL), which live
 * outside the member table. */
export type NoticeRecipients = { superAdmins: string[] };

/** The notice INSERT that follows a transition INSERT in one batch. It
 * writes only when the statement before it wrote a row (changes()>0), for
 * that send's newest transition, and only while that transition is at
 * `stage`. Recipients are resolved in the same statement: the configured
 * Super Admins (?5, a JSON array), the enabled Super Admin members, and the
 * asker on the project's send request unless it was withdrawn; lower-cased
 * and distinct. INSERT OR IGNORE on UNIQUE(send_id, seq, recipient): a
 * notice that already exists is kept, with its read state. */
export function noticeStatement(
  db: OnboardDb,
  sendId: string,
  stage: OnboardingStage,
  at: string,
  recipients: NoticeRecipients,
) {
  const sql =
    "WITH r(email) AS (" +
    "SELECT lower(trim(value)) FROM json_each(?5) " +
    "UNION SELECT lower(trim(email)) FROM atlas_members WHERE role_id='superadmin' AND disabled=0 " +
    "UNION SELECT lower(trim(json_extract(p.data,'$.onboarding.sendRequest.by'))) FROM atlas_flightdeck_operations o " +
    "JOIN atlas_projects p ON p.id=o.atlas_project_id WHERE o.id=?1 " +
    "AND json_extract(p.data,'$.onboarding.sendRequest.withdrawnAt') IS NULL) " +
    "INSERT OR IGNORE INTO atlas_notifications (id,recipient,project_id,text,created_at,read,send_id,seq) " +
    "SELECT 'flightdeck:'||t.send_id||':'||t.seq||':'||r.email,r.email,o.atlas_project_id,?3,?4,0,t.send_id,t.seq " +
    "FROM atlas_flightdeck_transitions t JOIN atlas_flightdeck_operations o ON o.id=t.send_id " +
    "JOIN atlas_projects p ON p.id=o.atlas_project_id JOIN r ON r.email IS NOT NULL AND r.email<>'' " +
    "WHERE t.send_id=?1 AND t.stage=?2 " +
    "AND t.seq=(SELECT MAX(seq) FROM atlas_flightdeck_transitions WHERE send_id=?1) " +
    "AND changes()>0";
  return db
    .prepare(sql)
    .bind(
      sendId,
      stage,
      noticeText(stage),
      at,
      JSON.stringify(recipients.superAdmins),
    );
}

export type NoticeRow = {
  id: string;
  recipient: string;
  project_id: string;
  text: string;
  created_at: string;
  read: number;
  send_id: string | null;
  seq: number | null;
};

/** A recipient's newest notices (at most 100), keeping only those whose
 * project `canView` allows now: access is re-checked on every read. */
export async function noticesFor(
  db: OnboardDb,
  recipient: string,
  canView: (projectId: string) => Promise<boolean>,
): Promise<NoticeRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM atlas_notifications WHERE recipient=? ORDER BY created_at DESC LIMIT 100",
    )
    .bind(recipient.trim().toLowerCase())
    .all<NoticeRow>();
  const out: NoticeRow[] = [];
  for (const row of results) if (await canView(row.project_id)) out.push(row);
  return out;
}

/** Marks one of the recipient's own notices read; stored, so it stays read.
 * Returns whether a notice of theirs was found. */
export async function markNoticeRead(
  db: OnboardDb,
  id: string,
  recipient: string,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE atlas_notifications SET read=1 WHERE id=? AND recipient=?")
    .bind(id, recipient.trim().toLowerCase())
    .run();
  return result.meta.changes > 0;
}
