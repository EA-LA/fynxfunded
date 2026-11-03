import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import FAQ from "@/pages/FAQ";
import NextPayoutWindow from "@/components/NextPayoutWindow";
import ScrollManager from "@/components/ScrollManager";
import { faqItems, faqTopics } from "@/lib/faqContent";
import { formatRange, payoutWindowStatus } from "@/lib/payoutCalendar";
import { Link } from "react-router-dom";

afterEach(cleanup);

const renderFaq = (path = "/faq") =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <FAQ />
      </MemoryRouter>
    </I18nProvider>,
  );

describe("faq content", () => {
  it("gives every question a unique id and a known topic", () => {
    const ids = faqItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const topicIds = faqTopics.map((t) => t.id);
    for (const item of faqItems) expect(topicIds).toContain(item.topic);
    for (const t of faqTopics) expect(faqItems.some((i) => i.topic === t.id)).toBe(true);
  });

  it("states the published rule figures", () => {
    const byId = (id: string) => faqItems.find((i) => i.id === id)!.a;
    expect(byId("daily-reset")).toContain("22:00 UTC");
    expect(byId("daily-loss")).toContain("$23,750");
    expect(byId("maximum-loss")).toContain("$22,500");
    expect(byId("consistency-rule")).toContain("$800");
    expect(byId("profit-targets")).toContain("8%, then 5%");
    expect(byId("profit-split")).toContain("75% and 90%");
    expect(byId("minimum-days")).toContain("15 trading days");
  });
});

describe("faq page", () => {
  it("groups questions by topic and filters with topic chips", () => {
    renderFaq();
    expect(screen.getByText(`${faqItems.length} questions in ${faqTopics.length} topics`)).toBeInTheDocument();
    for (const t of faqTopics) expect(screen.getByRole("heading", { name: t.label })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Payouts/ }));
    const payoutCount = faqItems.filter((i) => i.topic === "payouts").length;
    expect(screen.getByText(`${payoutCount} of ${faqItems.length} questions match`)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rules & limits" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "consistency" } });
    expect(screen.getByText(/No questions match "consistency" in Payouts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search all topics" }));
    expect(screen.getByText("How does the 40% consistency rule work?")).toBeInTheDocument();
  });

  it("opens the question named in the address and links onward", () => {
    renderFaq("/faq#daily-reset");
    const item = document.getElementById("daily-reset") as HTMLDetailsElement;
    expect(item.open).toBe(true);
    expect((document.getElementById("consistency-rule") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getAllByRole("link", { name: /Find the next window/ })[0]).toHaveAttribute("href", "/payouts#calendar");
    expect(screen.getAllByRole("button", { name: /Copy link to/ })).toHaveLength(faqItems.length);
  });
});

describe("payout calendar", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);

  it("finds the open or next request window in UTC", () => {
    const open = payoutWindowStatus(d("2026-11-02"));
    expect(open.open).toBe(true);
    expect(open.daysLeft).toBe(2);
    expect(formatRange(open.window.payoutStart, open.window.payoutEnd)).toBe("Nov 5 – 7");

    const before = payoutWindowStatus(d("2026-11-04"));
    expect(before.open).toBe(false);
    expect(before.daysUntilOpen).toBe(12);
    expect(formatRange(before.window.requestStart, before.window.requestEnd)).toBe("Nov 16 – 18");

    const lastDay = payoutWindowStatus(d("2026-11-18"));
    expect(lastDay.open).toBe(true);
    expect(lastDay.daysLeft).toBe(1);

    const yearEnd = payoutWindowStatus(d("2026-12-20"));
    expect(yearEnd.open).toBe(false);
    expect(yearEnd.window.requestStart.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(yearEnd.daysUntilOpen).toBe(12);
    expect(formatRange(yearEnd.following.requestStart, yearEnd.following.requestEnd)).toBe("Jan 16 – 18");
  });

  it("renders the next window card", () => {
    render(<NextPayoutWindow now={d("2026-11-04")} />);
    expect(screen.getByText("Next request window")).toBeInTheDocument();
    expect(screen.getByText("Nov 16 – 18")).toBeInTheDocument();
    expect(screen.getByText(/Opens in 12 days/)).toBeInTheDocument();
  });
});

describe("scroll manager", () => {
  it("opens new pages at the top", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const Where = () => <span>{useLocation().pathname}</span>;
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <ScrollManager />
        <Routes>
          <Route path="*" element={<><Where /><Link to="/b">next</Link></>} />
        </Routes>
      </MemoryRouter>,
    );
    scrollTo.mockClear();
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByText("/b")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    vi.unstubAllGlobals();
  });
});
