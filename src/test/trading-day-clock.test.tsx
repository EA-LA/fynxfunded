import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import TradingDayClock from "@/components/TradingDayClock";
import {
  formatCountdown, journalSessionForUtcHour, nextReset, parseLocalDateTime, previousReset, toLocalInputValue, tradingDayStatus, utcOffsetLabel,
} from "@/lib/tradingDayClock";
import { faqItems } from "@/lib/faqContent";

afterEach(cleanup);

describe("trading-day clock maths", () => {
  it("finds the 22:00 UTC reset either side of a moment", () => {
    const before = new Date("2026-11-04T16:30:00Z");
    expect(previousReset(before).toISOString()).toBe("2026-11-03T22:00:00.000Z");
    expect(nextReset(before).toISOString()).toBe("2026-11-04T22:00:00.000Z");
    const after = new Date("2026-11-04T23:15:00Z");
    expect(previousReset(after).toISOString()).toBe("2026-11-04T22:00:00.000Z");
    expect(nextReset(after).toISOString()).toBe("2026-11-05T22:00:00.000Z");
    const exactly = new Date("2026-11-04T22:00:00Z");
    expect(previousReset(exactly).toISOString()).toBe("2026-11-04T22:00:00.000Z");
    expect(nextReset(exactly).toISOString()).toBe("2026-11-05T22:00:00.000Z");
  });

  it("reports time left, share elapsed and the journal label", () => {
    const s = tradingDayStatus(new Date("2026-11-04T16:00:00Z"));
    expect(s.msUntilReset).toBe(6 * 3_600_000);
    expect(s.elapsed).toBe(0.75);
    expect(s.session).toBe("New York");
    expect(formatCountdown(s.msUntilReset)).toBe("6h 00m");
    expect(formatCountdown(125_000)).toBe("2m 05s");
    expect(formatCountdown(-5)).toBe("0m 00s");
  });

  it("uses the same session buckets as the trade journal", () => {
    expect([0, 7, 8, 12, 13, 23].map(journalSessionForUtcHour)).toEqual(["Asia", "Asia", "London", "London", "New York", "New York"]);
  });

  it("labels time zone offsets and round-trips datetime-local values", () => {
    expect(utcOffsetLabel(new Date("2026-07-01T12:00:00Z"), "UTC")).toBe("UTC");
    expect(utcOffsetLabel(new Date("2026-07-01T12:00:00Z"), "Asia/Kolkata")).toBe("UTC+5:30");
    expect(utcOffsetLabel(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe("UTC−5");
    const d = parseLocalDateTime("2026-11-04T17:30")!;
    expect(toLocalInputValue(d)).toBe("2026-11-04T17:30");
    expect(parseLocalDateTime("")).toBeNull();
    expect(parseLocalDateTime("2026-11-04")).toBeNull();
  });
});

describe("trading-day clock card", () => {
  const renderClock = (now: Date) => render(<MemoryRouter><TradingDayClock now={now} /></MemoryRouter>);

  it("shows UTC time, the countdown and highlights the current label", () => {
    renderClock(new Date("2026-11-04T09:15:30Z"));
    expect(screen.getByTestId("clock-utc")).toHaveTextContent("09:15:30");
    expect(screen.getByTestId("clock-countdown")).toHaveTextContent("12h 44m");
    const row = screen.getByRole("cell", { name: /London/ }).closest("tr")!;
    expect(within(row).getByText("now")).toBeInTheDocument();
    expect(screen.getByText(/not market or broker trading hours/)).toBeInTheDocument();
  });

  it("checks a chosen time against the daily-floor period", () => {
    renderClock(new Date("2026-11-04T09:15:30Z"));
    const input = screen.getByLabelText(/Check a time/);
    const local = new Date("2026-11-04T23:30:00Z");
    fireEvent.change(input, { target: { value: toLocalInputValue(local) } });
    const result = screen.getByTestId("clock-check-result");
    expect(result).toHaveTextContent("New York");
    expect(result).toHaveTextContent(/22:00 UTC/);
    expect(result).toHaveTextContent("22h 30m");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("status")).toHaveTextContent("Enter a full date and time");
  });

  it("is linked from the daily-reset FAQ answer", () => {
    expect(faqItems.find(i => i.id === "daily-reset")?.link?.to).toBe("/rules#trading-day");
  });
});
