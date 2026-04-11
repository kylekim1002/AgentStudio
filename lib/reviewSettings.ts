export const DEFAULT_REVIEW_SLA_HOURS = 24;

export function normalizeReviewSlaHours(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REVIEW_SLA_HOURS;
  return Math.min(168, Math.max(1, Math.round(parsed)));
}

export function getReviewWarningHours(slaHours: number): number {
  return Math.max(4, Math.round(slaHours / 2));
}
