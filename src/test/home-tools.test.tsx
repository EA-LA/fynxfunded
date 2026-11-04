import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import Index from "@/pages/Index";
import NextPayoutWindow from "@/components/NextPayoutWindow";
import { faqItems } from "@/lib/faqContent";
import { payoutWindowStatus, payoutWindowsIcs } from "@/lib/payoutCalendar";

vi.mock("@/components/CinematicBackground", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderHome = () =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    </I18nProvider>,
  );

describe("home page", () => {
  it("shows each plan's rules in dollars with a calculator link", () => {
    renderHome();
    const card = screen.getByRole("heading", { name: "$25K 2-phase" }).closest("div")!;
    expect(within(card).getByText("+$2,000")).toBeInTheDocument();
    expect(within(card).getByText("−$1,250")).toBeInTheDocument();
    expect(within(card).getByText("−$2,500")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /See these rules in dollars/ });
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.getAttribute("href"))).toContain("/rules?size=25000&program=2-phase#calculator");
  });

  it("links to the planning tools", () => {
    renderHome();
    const tools = screen.getByRole("region", { name: "Know Your Numbers Before You Start" });
    const hrefs = within(tools).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/rules#calculator", "/challenges#compare-programs", "/payouts#estimator", "/payouts#calendar"]));
  });

  it("links every previewed question to its answer on the FAQ page", () => {
    renderHome();
    const links = screen.getAllByRole("link", { name: /Read in the full FAQ/ });
    expect(links).toHaveLength(5);
    const ids = faqItems.map((i) => i.id);
    for (const link of links) {
      const id = link.getAttribute("href")!.replace("/faq#", "");
      expect(ids).toContain(id);
    }
  });
});

describe("payout calendar download", () => {
  const status = payoutWindowStatus(new Date("2026-11-04T12:00:00Z"));
  const ics = payoutWindowsIcs([status.window, status.following], new Date("2026-11-04T09:05:00Z"));

  it("builds valid all-day events for the next two windows", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261116\r\nDTEND;VALUE=DATE:20261119");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261204");
    expect(ics).toContain("DTSTAMP:20261104T090500Z");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Approved requests are scheduled for Nov 20 – 22 (UTC). Eligibility");
    expect(unfolded).toContain("accounts. Approved");
    expect(unfolded).toMatch(/DESCRIPTION:.*funded accounts\. /);
    expect(unfolded).toContain("Eligibility and the final payment date are confirmed when your request is reviewed.");
  });

  it("escapes commas in text values", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).not.toMatch(/DESCRIPTION:[^\r]*[^\\],/);
  });

  it("downloads the calendar file from the card", () => {
    const create = vi.fn(() => "blob:fynx");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<NextPayoutWindow now={new Date("2026-11-04T12:00:00Z")} />);
    fireEvent.click(screen.getByRole("button", { name: /Add both windows to my calendar/ }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
