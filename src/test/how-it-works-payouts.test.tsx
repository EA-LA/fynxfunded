import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import HowItWorks, { buildPath } from "@/pages/HowItWorks";
import PayoutsPage from "@/pages/PayoutsPage";
import { estimatePayout, splitRange, splitTable } from "@/lib/payoutEstimator";

afterEach(cleanup);

const renderPage = (node: React.ReactNode) =>
  render(
    <I18nProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nProvider>,
  );

describe("program path", () => {
  it("builds one step per phase plus the funded stage from the schedule", () => {
    const two = buildPath(25000, "2-phase");
    expect(two.map((s) => s.num)).toEqual(["Phase 1", "Phase 2", "Funded"]);
    expect(two[0].details[0]).toContain("+$2,000");
    expect(two[0].details[2]).toContain("$22,500");
    expect(two[1].link?.to).toBe("/rules?size=25000&program=2-phase&phase=2#calculator");
    expect(two[2].details[0]).toContain("80%");

    const three = buildPath(100000, "3-phase");
    expect(three).toHaveLength(4);
    expect(three[2].details[0]).toContain("4% profit target");
    expect(buildPath(5000, "1-phase")[0].details[3]).toBe("Trade minimum 3 days");
  });

  it("updates the page when the program and size change", () => {
    renderPage(<HowItWorks />);
    expect(screen.getAllByText(/^Phase \d$/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "3 phase" }));
    expect(screen.getAllByText(/^Phase \d$/)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "$100K" }));
    expect(screen.getByTestId("path-summary").textContent).toContain("$15,000 profit to make in total");
    expect(screen.getByText(/90% for this plan/)).toBeTruthy();
    expect(screen.getByText(/Each trading day resets at 22:00 UTC/)).toBeTruthy();
  });

  it("opens on a shared program and size and links to the risk planner for it", () => {
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/how-it-works?size=50000&program=1-phase"]}>
          <HowItWorks />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "$50K" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1 phase" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText(/^Phase \d$/)).toHaveLength(1);
    const planner = screen.getByRole("link", { name: /Plan your risk per trade for this account/ });
    expect(planner).toHaveAttribute("href", "/rules?size=50000&program=1-phase#risk-planner");
    fireEvent.click(screen.getByRole("button", { name: "$5K" }));
    expect(planner).toHaveAttribute("href", "/rules?size=5000&program=1-phase#risk-planner");
  });
});

describe("payout estimator", () => {
  it("applies the published split and minimum", () => {
    expect(estimatePayout(25000, "2-phase", 1000)).toMatchObject({ splitPercent: 80, traderShare: 800, firmShare: 200, meetsMinimum: true, profitPercentOfAccount: 4 });
    expect(estimatePayout(100000, "2-phase", 40)).toMatchObject({ traderShare: 36, meetsMinimum: false, profitForMinimum: 55.56 });
    expect(estimatePayout(10000, "1-phase", -500)).toMatchObject({ profit: 0, traderShare: 0 });
    expect(estimatePayout(10000, "1-phase", Number.NaN).traderShare).toBe(0);
  });

  it("lists every size and program in the split table", () => {
    const rows = splitTable();
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.accountSize === 25000)?.splits).toEqual({ "1-phase": 80, "2-phase": 80, "3-phase": 85 });
    expect(splitRange()).toEqual({ min: 75, max: 90 });
  });

  it("recalculates on the payouts page", () => {
    renderPage(<PayoutsPage />);
    const table = screen.getByRole("table", { name: /profit split by account size/i });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(screen.getByText(/keep 75% to 90%/)).toBeTruthy();
    expect(screen.getByTestId("trader-share").textContent).toBe("$800");
    // The readiness check further down has its own size buttons; use the estimator's.
    fireEvent.click(within(document.getElementById("estimator")!).getByRole("button", { name: "$100K" }));
    fireEvent.change(screen.getByLabelText(/net profit in the funded account/i), { target: { value: "$2,500" } });
    expect(screen.getByTestId("trader-share").textContent).toBe("$2,250");
    fireEvent.change(screen.getByLabelText(/net profit in the funded account/i), { target: { value: "20" } });
    expect(screen.getByText(/Below the \$50 minimum/)).toBeTruthy();
  });
});
