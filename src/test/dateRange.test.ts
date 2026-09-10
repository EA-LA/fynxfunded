import { describe, expect, it } from "vitest";
import { filterByDateRange, rangeStart } from "@/lib/dateRange";

const now = new Date("2026-09-10T12:00:00-07:00");
const records = [
  { id: "today", closed: "2026-09-10T09:00:00-07:00" },
  { id: "seven-day-edge", closed: "2026-09-04T00:00:00-07:00" },
  { id: "older-than-seven", closed: "2026-09-03T23:59:59-07:00" },
  { id: "within-thirty", closed: "2026-08-12T08:00:00-07:00" },
  { id: "older-than-thirty", closed: "2026-08-11T23:59:59-07:00" },
  { id: "invalid", closed: "not-a-date" },
];

describe("analytics date ranges", () => {
  it("uses inclusive calendar-day boundaries", () => {
    expect(rangeStart("7D", now)?.toISOString()).toBe("2026-09-04T07:00:00.000Z");
    expect(rangeStart("30D", now)?.toISOString()).toBe("2026-08-12T07:00:00.000Z");
  });

  it("returns only records in the selected period", () => {
    expect(filterByDateRange(records, "7D", (record) => record.closed, now).map((record) => record.id)).toEqual(["today", "seven-day-edge"]);
    expect(filterByDateRange(records, "30D", (record) => record.closed, now).map((record) => record.id)).toEqual(["today", "seven-day-edge", "older-than-seven", "within-thirty"]);
    expect(filterByDateRange(records, "All", (record) => record.closed, now)).toHaveLength(records.length);
  });
});
