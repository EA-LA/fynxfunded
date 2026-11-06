import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { checkPayoutReadiness, type ReadinessInput } from "@/lib/payoutReadiness";
import PayoutReadiness from "@/components/PayoutReadiness";
import PayoutsPage from "@/pages/PayoutsPage";
import ChallengesPricing from "@/pages/ChallengesPricing";
import HowItWorks from "@/pages/HowItWorks";
import { faqItems } from "@/lib/faqContent";

afterEach(cleanup);

const base: ReadinessInput = {
  accountSize: 25000,
  program: "2-phase",
  netProfit: 1000,
  tradingDays: 6,
  noViolations: true,
  positionsClosed: true,
  kycDone: true,
};
const nov10 = new Date(Date.UTC(2026, 10, 10, 12));
const nov17 = new Date(Date.UTC(2026, 10, 17, 12));

describe("checkPayoutReadiness", () => {
  it("is ready when every published condition is met, and names the next window", () => {
    const r = checkPayoutReadiness(base, nov10);
    expect(r.ready).toBe(true);
    expect(r.metCount).toBe(5);
    expect(r.summary).toContain("Nov 16 – 18");
    expect(r.summary).toContain("opens in 6 days");
    const open = checkPayoutReadiness(base, nov17);
    expect(open.summary).toContain("open now until Nov 18");
  });

  it("explains each missing condition", () => {
    const r = checkPayoutReadiness({ ...base, tradingDays: 3, kycDone: false, netProfit: 40 }, nov10);
    expect(r.ready).toBe(false);
    expect(r.daysShort).toBe(2);
    expect(r.missing.map((c) => c.id)).toEqual(["days", "kyc", "minimum"]);
    expect(r.checks.find((c) => c.id === "days")!.detail).toContain("2 more days");
    // 40 × the plan's split is below the $50 minimum; the profit needed is shown.
    const min = r.checks.find((c) => c.id === "minimum")!;
    expect(min.detail).toContain(`$${r.traderShare}`);
    expect(r.summary).toMatch(/^3 things to sort out/);
  });

  it("treats blank answers as unanswered, never as met", () => {
    const r = checkPayoutReadiness(
      { ...base, netProfit: null, tradingDays: null, noViolations: null, positionsClosed: null, kycDone: null },
      nov10,
    );
    expect(r.metCount).toBe(0);
    expect(r.unanswered).toHaveLength(5);
    expect(r.ready).toBe(false);
    expect(r.summary).toContain("remaining 5 questions");
    expect(checkPayoutReadiness({ ...base, tradingDays: -2 }, nov10).checks[0].state).toBe("unanswered");
  });
});

const renderPage = (node: React.ReactNode) =>
  render(
    <I18nProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nProvider>,
  );

describe("PayoutReadiness", () => {
  it("updates as the trader answers and links to verification when KYC is missing", () => {
    renderPage(<PayoutReadiness now={nov10} />);
    const result = screen.getByTestId("readiness-result");
    expect(within(result).getByText("0 of 5 conditions met")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Trading days since your last payout"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Net profit since then (USD)"), { target: { value: "$1,200" } });
    const yes = screen.getAllByRole("button", { name: /^Yes/ });
    fireEvent.click(yes[0]);
    fireEvent.click(yes[1]);
    expect(within(result).getByText("4 of 5 conditions met")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "No" })[1]);
    expect(within(result).getByText("Not ready yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start identity verification" }).getAttribute("href")).toBe("/verification");
    fireEvent.click(yes[2]);
    expect(within(result).getByText("Ready to request")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear my answers/ }));
    expect(within(result).getByText("0 of 5 conditions met")).toBeTruthy();
  });

  it("appears on the payouts page and the FAQ eligibility answer links to it", () => {
    renderPage(<PayoutsPage />);
    expect(screen.getByRole("heading", { name: /Am I ready to request a payout\?/ })).toBeTruthy();
    expect(document.querySelector('[data-glossary-term="kyc"]')).not.toBeNull();
    expect(faqItems.find((f) => f.id === "payout-eligibility")!.link!.to).toBe("/payouts#readiness");
  });
});

describe("glossary help on marketing pages", () => {
  it("explains plan and comparison labels on Challenges", () => {
    renderPage(<ChallengesPricing />);
    expect(screen.getAllByRole("button", { name: /Daily Loss Limit: What does "daily loss limit" mean\?/ }).length).toBeGreaterThan(1);
    expect(screen.getByRole("rowheader", { name: /Profit Target\(s\)/ })).toBeTruthy();
    const quick = screen.getByRole("button", { name: "Quick" });
    expect(quick.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Full" }));
    expect(screen.getByRole("button", { name: /Consistency Rule: What does/ })).toBeTruthy();
  });

  it("lists the words used on every How it works step", () => {
    renderPage(<HowItWorks />);
    const tips = Array.from(document.querySelectorAll("[data-glossary-term]")).map((n) => n.getAttribute("data-glossary-term"));
    for (const id of ["profit-target", "maximum-loss", "funded-stage", "profit-split", "daily-reset"]) expect(tips).toContain(id);
  });
});
