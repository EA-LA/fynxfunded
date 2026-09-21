import { describe, expect, it } from "vitest";
import { filterByDateRange, rangeStart } from "@/lib/dateRange";

// The product uses local calendar days, so fixtures must use the runner's local zone too.
const now = new Date(2026, 8, 10, 12);
const records = [
  { id: "today", closed: new Date(2026, 8, 10, 9) },
  { id: "seven-day-edge", closed: new Date(2026, 8, 4) },
  { id: "older-than-seven", closed: new Date(2026, 8, 3, 23, 59, 59) },
  { id: "within-thirty", closed: new Date(2026, 7, 12, 8) },
  { id: "older-than-thirty", closed: new Date(2026, 7, 11, 23, 59, 59) },
  { id: "invalid", closed: "not-a-date" },
];

describe("analytics date ranges", () => {
  it("uses inclusive calendar-day boundaries", () => {
    expect(rangeStart("7D", now)).toEqual(new Date(2026, 8, 4));
    expect(rangeStart("30D", now)).toEqual(new Date(2026, 7, 12));
  });

  it("returns only records in the selected period", () => {
    expect(filterByDateRange(records, "7D", (record) => record.closed, now).map((record) => record.id)).toEqual(["today", "seven-day-edge"]);
    expect(filterByDateRange(records, "30D", (record) => record.closed, now).map((record) => record.id)).toEqual(["today", "seven-day-edge", "older-than-seven", "within-thirty"]);
    expect(filterByDateRange(records, "All", (record) => record.closed, now)).toHaveLength(records.length);
  });
});
