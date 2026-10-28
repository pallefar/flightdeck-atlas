// Value records and the portfolio roll-up.
//
// The one rule that matters (PRD §7.7, FR-25): an estimate is never shown as
// measured. So every record carries a basis, a measured record without a
// source is refused at the boundary, and the roll-up keeps the bases apart
// instead of adding them into one flattering number.
//
// The tier list is PROVISIONAL. PRD §14 question 7 asks whether to use the AI
// Jam value-case tracker tiers; until the owner answers, the tiers below are
// config with a version, not constants baked into a component.
export const VALUE_BASES = ["estimate", "measured", "not-tracked"] as const;
export type ValueBasis = (typeof VALUE_BASES)[number];
export const VALUE_PERIODS = ["baseline", "d30", "d90"] as const;
export type ValuePeriod = (typeof VALUE_PERIODS)[number];
export const CONFIDENCE = ["low", "medium", "high", "unknown"] as const;
export type Confidence = (typeof CONFIDENCE)[number];
export type ValueFigures = {
  hours?: number;
  cost?: number;
  errorRate?: number;
  volume?: number;
};
export type ValueInput = {
  basis: ValueBasis;
  period: ValuePeriod;
  figures: ValueFigures;
  target?: ValueFigures | null;
  tier?: string | null;
  method: string;
  methodVersion: string;
  confidence: Confidence;
  sourceRef?: string | null;
  notes?: string;
};
export type ValueProblem =
  | "measured_without_source"
  | "no_figures"
  | "negative_figure"
  | "not_finite"
  | "unknown_tier"
  | "empty_method"
  | "error_rate_range";
/** Tier ids only. Labels are UI strings (i18n `brain.value.tier.<id>`). */
export const VALUE_TIER_CONFIG = {
  version: "provisional-1",
  provisional: true,
  tiers: [
    "capacity-release",
    "cycle-time",
    "quality-and-rework",
    "risk-and-compliance",
    "revenue-enablement",
  ],
} as const;
const tiers = new Set<string>(VALUE_TIER_CONFIG.tiers);
const FIELDS = ["hours", "cost", "errorRate", "volume"] as const;
/**
 * Validate one record. Returns the problems, not a message: the route maps
 * them to a status code and the UI translates them.
 */
export function valueProblems(input: ValueInput): ValueProblem[] {
  const out: ValueProblem[] = [];
  const figures = FIELDS.map((k) => input.figures[k]).filter(
    (v): v is number => v !== undefined,
  );
  if (input.basis === "not-tracked") {
    // A not-tracked record is honest about having no numbers; it must not
    // carry figures that would then be summed by mistake.
    if (figures.length > 0) out.push("no_figures");
  } else if (figures.length === 0) {
    out.push("no_figures");
  }
  for (const value of figures) {
    if (!Number.isFinite(value)) out.push("not_finite");
    else if (value < 0) out.push("negative_figure");
  }
  if (
    input.figures.errorRate !== undefined &&
    (input.figures.errorRate < 0 || input.figures.errorRate > 1)
  )
    out.push("error_rate_range");
  if (input.basis === "measured" && !input.sourceRef?.trim())
    out.push("measured_without_source");
  if (input.tier && !tiers.has(input.tier)) out.push("unknown_tier");
  if (!input.method.trim() || !input.methodVersion.trim())
    out.push("empty_method");
  return [...new Set(out)];
}
/** Fraction (0..1) or null. Never a guess. */
export function valueRatio(current: number, baseline: number) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0)
    return null;
  return (current - baseline) / baseline;
}
export type RollUp = {
  /** Sums per basis, per figure. Kept apart on purpose. */
  measured: ValueFigures;
  estimate: ValueFigures;
  /** Projects that have no numbers at all. */
  notTracked: number;
  /** True when at least one figure came from both bases, so a single total
   * would be a lie; the UI must show the two columns. */
  mixed: boolean;
};
const add = (
  into: ValueFigures,
  from: ValueFigures,
): ValueFigures => ({
  hours: (into.hours ?? 0) + (from.hours ?? 0),
  cost: (into.cost ?? 0) + (from.cost ?? 0),
  errorRate: into.errorRate,
  volume: (into.volume ?? 0) + (from.volume ?? 0),
});
/** Roll up one period's records. `errorRate` is never summed: averaging error
 * rates across processes of different volume is not a number anyone should
 * act on, so it stays out of the totals. */
export function rollUp(records: ValueInput[]): RollUp {
  const result: RollUp = {
    measured: {},
    estimate: {},
    notTracked: 0,
    mixed: false,
  };
  for (const record of records) {
    if (record.basis === "not-tracked") {
      result.notTracked += 1;
      continue;
    }
    if (record.basis === "measured") result.measured = add(result.measured, record.figures);
    else result.estimate = add(result.estimate, record.figures);
  }
  const has = (v: ValueFigures) =>
    v.hours !== undefined || v.cost !== undefined || v.volume !== undefined;
  result.mixed = has(result.measured) && has(result.estimate);
  return result;
}
