export type AnalyticsRange = "7D" | "30D" | "All";

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = ["7D", "30D", "All"];

export function rangeStart(range: AnalyticsRange, now = new Date()): Date | null {
  if (range === "All") return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (range === "7D" ? 6 : 29));
  return start;
}

export function filterByDateRange<T>(
  records: readonly T[],
  range: AnalyticsRange,
  getDate: (record: T) => string | Date | null | undefined,
  now = new Date(),
): T[] {
  const start = rangeStart(range, now);
  if (!start) return [...records];

  const end = new Date(now);
  return records.filter((record) => {
    const value = getDate(record);
    if (!value) return false;
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp <= end.getTime();
  });
}

export function analyticsRangeLabel(range: AnalyticsRange): string {
  if (range === "7D") return "Last 7 calendar days";
  if (range === "30D") return "Last 30 calendar days";
  return "All recorded history";
}
