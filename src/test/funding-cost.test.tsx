import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import ChallengeSimulator from "@/components/ChallengeSimulator";
import PayoutEstimator from "@/components/PayoutEstimator";
import FundingCostCard from "@/components/FundingCostCard";
import { feePayback, fundingCost } from "@/lib/fundingCost";
import { faqItems } from "@/lib/faqContent";
import { getGlossaryTerm } from "@/lib/glossary";
import { sideBreakdown } from "@/lib/sideBreakdown";
import type { Trade } from "@/lib/tradingData";

afterEach(cleanup);

describe("funding cost maths", () => {
  it("turns a pass rate into attempts, fees and the profit needed to earn them back", () => {
    // 25K two-phase: $199 fee, 80% split. 1 in 4 finished runs passed.
    const c = fundingCost({ accountSize: 25000, program: "2-phase", passed: 500, ended: 1500, unfinished: 0 })!;
    expect(c.fee).toBe(199);
    expect(c.splitPercent).toBe(80);
    expect(c.passChancePercent).toBe(25);
    expect(c.expectedAttempts).toBe(4);
    expect(c.expectedFees).toBe(796);
    expect(c.profitToCoverFee).toBe(248.75);
    expect(c.profitToCoverExpectedFees).toBe(995);
    expect(c.profitToCoverExpectedPercent).toBe(4);
    expect(c.withinAttempts).toEqual([
      { attempts: 1, percent: 25 },
      { attempts: 2, percent: 43.8 },
      { attempts: 3, percent: 57.8 },
      { attempts: 5, percent: 76.3 },
    ]);
    // 1 - 0.75^8 = 0.8999 (< 90%), 1 - 0.75^9 = 0.925
    expect(c.attemptsFor90).toBe(9);
    expect(c.lowSample).toBe(false);
  });

  it("leaves out runs still going at the trader's own day limit", () => {
    const c = fundingCost({ accountSize: 25000, program: "2-phase", passed: 500, ended: 500, unfinished: 1000 })!;
    expect(c.passChancePercent).toBe(50);
    expect(c.expectedAttempts).toBe(2);
    expect(c.unfinishedPercent).toBe(50);
  });

  it("handles every run passing, none passing and none finishing", () => {
    expect(fundingCost({ accountSize: 25000, program: "2-phase", passed: 2000, ended: 0, unfinished: 0 })!.attemptsFor90).toBe(1);
    const none = fundingCost({ accountSize: 25000, program: "2-phase", passed: 0, ended: 2000, unfinished: 0 })!;
    expect(none.expectedAttempts).toBeNull();
    expect(none.expectedFees).toBeNull();
    expect(none.attemptsFor90).toBeNull();
    expect(none.withinAttempts.every((w) => w.percent === 0)).toBe(true);
    expect(fundingCost({ accountSize: 25000, program: "2-phase", passed: 0, ended: 0, unfinished: 2000 })).toBeNull();
    expect(fundingCost({ accountSize: 25000, program: "2-phase", passed: 5, ended: 5, unfinished: 0 })!.lowSample).toBe(true);
  });

  it("compares a payout share with one fee", () => {
    expect(feePayback(25000, "2-phase", 800)).toMatchObject({ fee: 199, covered: true, timesFee: 4, profitToCoverFee: 248.75, profitToCoverFeePercent: 1 });
    expect(feePayback(25000, "2-phase", 150)).toMatchObject({ covered: false, shortBy: 49 });
    expect(feePayback(25000, "2-phase", Number.NaN)).toMatchObject({ covered: false, timesFee: 0 });
  });
});

describe("what getting funded could cost, in the pass simulator", () => {
  it("shows the cost card when all phases are simulated", () => {
    render(<MemoryRouter initialEntries={["/rules?size=25000&program=2-phase&sphase=all&risk=0.5&rr=2&wr=50&tpd=1#simulator"]}><ChallengeSimulator /></MemoryRouter>);
    const card = screen.getByTestId("funding-cost");
    expect(within(card).getByRole("heading", { name: "What getting funded could cost at these odds" })).toBeInTheDocument();
    expect(card).toHaveTextContent("$199 per attempt");
    expect(within(card).getByTestId("funding-fees").textContent).toMatch(/^\$[\d,.]+$/);
    expect(within(card).getByText("1 attempt")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "refund policy" }).getAttribute("href")).toBe("/refund-policy");
  });

  it("offers to simulate all phases when only one phase is chosen", () => {
    render(<MemoryRouter initialEntries={["/rules?size=25000&program=2-phase&risk=0.5&rr=2&wr=50&tpd=1#simulator"]}><ChallengeSimulator /></MemoryRouter>);
    expect(screen.queryByTestId("funding-cost")).toBeNull();
    fireEvent.click(within(screen.getByTestId("funding-cost-hint")).getByRole("button", { name: "Simulate all phases" }));
    expect(screen.getByTestId("funding-cost")).toBeInTheDocument();
  });

  it("shows the cost card on one-phase programs without choosing a phase", () => {
    render(<MemoryRouter initialEntries={["/rules?size=10000&program=1-phase&risk=0.5&rr=2&wr=50&tpd=1#simulator"]}><ChallengeSimulator /></MemoryRouter>);
    expect(screen.getByTestId("funding-cost")).toHaveTextContent("$99 per attempt");
  });

  it("warns when no run passed", () => {
    render(<MemoryRouter><FundingCostCard accountSize={25000} program="2-phase" passed={0} ended={2000} unfinished={0} /></MemoryRouter>);
    expect(screen.getByTestId("funding-cost")).toHaveTextContent("No simulated run passed");
  });
});

describe("fee comparison in the payout estimator", () => {
  it("compares the estimated share with the challenge fee and links to the simulator", () => {
    render(<MemoryRouter><PayoutEstimator /></MemoryRouter>);
    const box = screen.getByTestId("fee-payback");
    // Default: 25K two-phase, $1,000 profit at 80% -> $800 share, $199 fee.
    expect(box).toHaveTextContent("Your share would cover the $199 fee for this challenge 4 times.");
    expect(within(box).getByRole("link", { name: "what getting funded could cost" }).getAttribute("href")).toBe("/rules?size=25000&program=2-phase&sphase=all#simulator");
    fireEvent.change(screen.getByLabelText("Net profit in the funded account (USD)"), { target: { value: "150" } });
    expect(box).toHaveTextContent("Your share would be $79 short of the $199 fee");
  });
});

describe("FAQ and glossary", () => {
  it("answers how much getting funded could cost, with the published fee", () => {
    const item = faqItems.find((i) => i.id === "funding-cost")!;
    expect(item.a).toContain("$796 in fees at $199 each");
    expect(item.a).toContain("$995 of funded profit at the 80% split");
    expect(item.link?.to).toBe("/rules?size=25000&program=2-phase&sphase=all#simulator");
    expect(getGlossaryTerm("challenge-fee")).toBeDefined();
    expect(getGlossaryTerm("long-short")).toBeDefined();
  });
});

describe("long / short breakdown", () => {
  const t = (id: string, type: "Buy" | "Sell", pnl: number) => ({ id, type, pnl }) as Trade;
  it("works out win rate and average per side", () => {
    const b = sideBreakdown([t("1", "Buy", 100), t("2", "Buy", -50), t("3", "Buy", 40), t("4", "Buy", 0), t("5", "Sell", -30), t("6", "Sell", -20), t("7", "Sell", 20)]);
    expect(b.long).toMatchObject({ count: 4, wins: 2, losses: 1, winRate: 50, pnl: 90, average: 22.5 });
    expect(b.short).toMatchObject({ count: 3, wins: 1, losses: 2, winRate: 33.33, pnl: -30, average: -10 });
    expect(b.long.share).toBe(57.14);
    expect(b.note).toBe("Long trades average $32.50 more per trade than short trades.");
  });
  it("waits for three trades per side before comparing", () => {
    expect(sideBreakdown([t("1", "Buy", 100), t("2", "Sell", 10)]).note).toBeNull();
    expect(sideBreakdown([]).long).toMatchObject({ count: 0, winRate: 0, average: 0, share: 0 });
  });
});
