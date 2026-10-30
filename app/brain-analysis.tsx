"use client";
// The readiness panel: a checklist score over the facts the server sent, the
// counts behind it, the risks those counts imply, and the next actions — each
// one a link to the section that does it.
import { analyseBrain } from "@/lib/domain/analysis";
import type { BrainView } from "@/lib/domain/brain-view";
import type { MessageKey } from "@/lib/i18n";
type Translate = (key: MessageKey, params?: Record<string, string>) => string;
export type SectionAnchor = "intake" | "reuse" | "evidence" | "value" | "roles" | "gate";
export default function BrainAnalysisPanel({
  view,
  t,
  onGo,
}: {
  view: BrainView;
  t: Translate;
  onGo: (anchor: SectionAnchor) => void;
}) {
  const analysis = analyseBrain(view);
  return (
    <section aria-label={t("brain.analysis.title")}>
      <h3>{t("brain.analysis.title")}</h3>
      <div className="brain-analysis-head">
        <span>{t("brain.analysis.readiness")}</span>
        <strong>{analysis.readiness}%</strong>
      </div>
      <div
        className="brain-meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={analysis.readiness}
        aria-label={t("brain.analysis.readiness")}
      >
        <span style={{ width: `${analysis.readiness}%` }} />
      </div>
      <p className="brain-hint">
        {t("brain.analysis.checklist", {
          met: String(analysis.met),
          total: String(analysis.total),
        })}
      </p>
      <dl className="brain-analysis-facts">
        <div>
          <dt>{t("brain.analysis.roles")}</dt>
          <dd>{analysis.rolesFilled}/4</dd>
        </div>
        <div>
          <dt>{t("brain.analysis.evidence")}</dt>
          <dd>
            {analysis.evidenceAccepted} · {analysis.evidencePending} ·{" "}
            {analysis.evidenceNeedsReview}
          </dd>
        </div>
        <div>
          <dt>{t("brain.analysis.value")}</dt>
          <dd>
            {analysis.hasBaseline
              ? t("brain.analysis.baselineYes")
              : t("brain.analysis.baselineNo", { count: String(analysis.valueRecords) })}
          </dd>
        </div>
        <div>
          <dt>{t("brain.analysis.audit")}</dt>
          <dd>{analysis.chainOk ? analysis.chainLength : t("brain.analysis.broken")}</dd>
        </div>
      </dl>
      {analysis.risks.length > 0 && (
        <ul className="brain-risks">
          {analysis.risks.map((risk) => (
            <li key={risk}>{t(`brain.risk.${risk}` as never)}</li>
          ))}
        </ul>
      )}
      <h4 className="brain-subhead">{t("brain.analysis.next")}</h4>
      {analysis.nextActions.length === 0 ? (
        <p className="brain-hint">{t("brain.analysis.none")}</p>
      ) : (
        <ul className="brain-actions">
          {analysis.nextActions.map((action, index) => (
            <li key={`${action.kind}-${action.requirement ?? index}`}>
              <button type="button" onClick={() => onGo(action.anchor)}>
                <span aria-hidden="true">→</span>{" "}
                {action.kind === "requirement" && action.requirement
                  ? t(`brain.requirement.${action.requirement}` as never)
                  : t(`brain.action.${action.kind}` as never)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
