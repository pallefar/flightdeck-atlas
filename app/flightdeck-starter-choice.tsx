"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldLabel } from "@/lib/flightdeck/onboarding";
import {
  starterView,
  type AppliedStarter,
  type Starter,
  type StarterTarget,
} from "@/lib/flightdeck/starters";
import { t, type Locale } from "@/lib/i18n";

// 'Start blank' or an owner-approved starter, with a preview of exactly the
// fields it fills and an Undo once applied. With no approved starter there
// is nothing to choose, so this renders nothing and the step is skipped.
export function StarterChoice({
  starters,
  target,
  locale,
  onApply,
  onUndo,
  applied,
  initialChoice = "blank",
}: {
  starters: Starter[];
  target: StarterTarget;
  locale: Locale;
  onApply: (starter: Starter) => void;
  onUndo: () => void;
  applied: AppliedStarter | null;
  initialChoice?: string;
}) {
  const [choice, setChoice] = useState(initialChoice);
  const name = useId();
  const view = starterView(starters, target, choice, applied);
  if (!view) return null;
  if (view.kind === "applied")
    return (
      <div className="fd-suggest" role="status">
        <p>
          {t("onb.starter.applied", locale, {
            name: view.applied.name,
            version: view.applied.version,
          })}
        </p>
        <Button type="button" variant="outline" onClick={onUndo}>
          {t("onb.starter.undo", locale)}
        </Button>
      </div>
    );
  const { chosen, plan } = view;
  return (
    <fieldset className="fd-suggest">
      <legend>{t("onb.starter.title", locale)}</legend>
      <label>
        <input
          type="radio"
          name={name}
          checked={!chosen}
          onChange={() => setChoice("blank")}
        />{" "}
        {t("onb.starter.blank", locale)}
      </label>
      {starters.map((s) => (
        <label key={s.id}>
          <input
            type="radio"
            name={name}
            checked={choice === s.id}
            onChange={() => setChoice(s.id)}
          />{" "}
          <strong>{s.name}</strong>{" "}
          <span className="fd-hint">
            {t("onb.starter.meta", locale, {
              owner: s.owner,
              version: s.version,
              date: s.approvedAt.slice(0, 10),
            })}
          </span>
        </label>
      ))}
      {chosen && (
        <>
          <p>
            {plan.length
              ? t("onb.starter.preview", locale)
              : t("onb.starter.nothing", locale)}
          </p>
          {!!plan.length && (
            <ul>
              {plan.map((p) => (
                <li key={p.field}>
                  {fieldLabel(`profile.${p.field}`)}: <strong>{p.after}</strong>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!plan.length}
            onClick={() => onApply(chosen)}
          >
            {t("onb.starter.apply", locale)}
          </Button>
        </>
      )}
    </fieldset>
  );
}
