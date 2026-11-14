import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChallengeFinder from "@/components/ChallengeFinder";
import ChallengesPricing from "@/pages/ChallengesPricing";
import { I18nProvider } from "@/lib/i18n";
import { faqItems } from "@/lib/faqContent";
import {
  DEFAULT_FINDER_INPUT,
  buildOptions,
  cautionsFor,
  explainOption,
  findChallenges,
  finderLink,
  earliestWeeks,
  maxRiskFor,
  parseFinderParams,
  type FinderInput,
} from "@/lib/challengeFinder";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const input = (over: Partial<FinderInput> = {}): FinderInput => ({ ...DEFAULT_FINDER_INPUT, ...over });

describe("challenge finder logic", () => {
  it("considers every published size × program", () => {
    const options = buildOptions(input());
    expect(options).toHaveLength(18);
    expect(options.every((o) => o.fits)).toBe(true);
  });

  it("filters by budget and ranks by the chosen priority", () => {
    const cheap = findChallenges(input({ budget: 100 }));
    expect(cheap.matches.every((o) => o.summary.price <= 100)).toBe(true);
    expect(cheap.matches[0].id).toBe("5000-3-phase"); // $29

    const largest = findChallenges(input({ budget: 250, priority: "largest-account" }));
    expect(largest.matches[0]).toMatchObject({ accountSize: 25000, program: "3-phase" }); // $149 beats $199 and $229

    const fastest = findChallenges(input({ budget: 250, priority: "fastest" }));
    expect(fastest.matches[0]).toMatchObject({ accountSize: 25000, program: "1-phase" }); // 3 days, largest within budget

    const room = findChallenges(input({ budget: 500, priority: "most-room" }));
    expect(room.matches[0]).toMatchObject({ accountSize: 100000, program: "3-phase" }); // $449: 12% of 100K = $12,000

    const split = findChallenges(input({ priority: "best-split" }));
    expect(split.matches[0].summary.plan.profitSplitPercent).toBe(90);
    expect(split.matches[0].accountSize).toBe(200000);
  });

  it("checks a dollar risk against the daily allowance", () => {
    // $25K 2-phase: 5% = $1,250 → 10 losses of $125; $10K 2-phase: $500 → 4 losses.
    const options = buildOptions(input({ riskPerTrade: 125, losingTrades: 5 }));
    const big = options.find((o) => o.id === "25000-2-phase")!;
    const small = options.find((o) => o.id === "10000-2-phase")!;
    expect(big).toMatchObject({ lossesToDailyFloor: 10, lossesToMaxFloor: 20, riskPercent: 0.5, supportsRisk: true });
    expect(small).toMatchObject({ lossesToDailyFloor: 4, supportsRisk: false, fits: false });
    expect(maxRiskFor(small, 5)).toBe(100);
  });

  it("explains what would need to change when nothing fits", () => {
    const r = findChallenges(input({ budget: 50, riskPerTrade: 500, losingTrades: 3 }));
    expect(r.matches).toHaveLength(0);
    expect(r.nearMisses[0].option.summary.price).toBeLessThanOrEqual(50);
    expect(r.nearMisses[0].change).toMatch(/risk \$\d+(\.\d+)? or less per trade/);
    expect(r.nearMisses[1].change).toMatch(/above your budget/);
    expect(r.nearMisses[1].option.supportsRisk).toBe(true);
  });

  it("restricts programs and gives reasons and cautions", () => {
    const i = input({ budget: 250, riskPerTrade: 100, programs: ["1-phase"] });
    const r = findChallenges(i);
    expect(r.considered.every((o) => o.program === "1-phase")).toBe(true);
    const reasons = explainOption(r.matches[0], i, r.matches);
    expect(reasons[0]).toMatch(/Lowest fee of the/);
    expect(reasons.join(" ")).toMatch(/within your \$250 budget/);
    expect(reasons.join(" ")).toMatch(/full losses fit in one day/);
    expect(cautionsFor(r.matches[0]).join(" ")).toMatch(/Tighter limits/);
  });

  it("works out the earliest calendar time for the minimum days at the trader's pace", () => {
    expect(earliestWeeks(15, 5)).toBe(3);
    expect(earliestWeeks(10, 3)).toBe(4); // 3 + 3 + 3 + 1
    expect(earliestWeeks(3, 1)).toBe(3);
    expect(earliestWeeks(5, 9)).toBe(1); // capped at 5 days a week
    const options = buildOptions(input({ daysPerWeek: 2 }));
    expect(options.find((o) => o.id === "25000-1-phase")!.earliestWeeks).toBe(2); // 3 days
    expect(options.find((o) => o.id === "25000-2-phase")!.earliestWeeks).toBe(5); // 10 days
    expect(options.find((o) => o.id === "25000-3-phase")!.earliestWeeks).toBe(8); // 15 days
    expect(buildOptions(input()).every((o) => o.earliestWeeks === null)).toBe(true);
    const i = input({ daysPerWeek: 3, programs: ["3-phase"] });
    const r = findChallenges(i);
    expect(explainOption(r.matches[0], i, r.matches).join(" ")).toContain("Trading 3 days a week, the 15 minimum trading days take at least 5 weeks.");
  });

  it("round-trips the choices through a shareable link", () => {
    const i = input({ budget: 300, priority: "most-room", riskPerTrade: 80, losingTrades: 4, programs: ["2-phase", "3-phase"] });
    const link = finderLink(i);
    expect(link).toBe("/challenges?fbudget=300&fpri=most-room&frisk=80&flosses=4&fprog=2-phase%2C3-phase#finder");
    const params = new URL(link, "https://example.test").searchParams;
    expect(parseFinderParams(params)).toEqual(i);
    expect(finderLink(DEFAULT_FINDER_INPUT)).toBe("/challenges#finder");
    expect(parseFinderParams(new URLSearchParams("fbudget=-5&fpri=nope&frisk=abc&flosses=7&fprog=9-phase&fdays=7"))).toEqual(DEFAULT_FINDER_INPUT);
    const paced = input({ daysPerWeek: 4 });
    expect(finderLink(paced)).toBe("/challenges?fdays=4#finder");
    expect(parseFinderParams(new URL(finderLink(paced), "https://example.test").searchParams)).toEqual(paced);
  });
});

const renderFinder = (path = "/challenges") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ChallengeFinder />
    </MemoryRouter>,
  );

describe("challenge finder widget", () => {
  it("shows the best matches for a budget and risk", () => {
    renderFinder();
    expect(screen.getByText("18 of 18 plans fit. Top 3 shown.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "$250" }));
    fireEvent.change(screen.getByLabelText(/Your usual risk per trade/), { target: { value: "100" } });
    const list = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-label")?.startsWith("Option"));
    expect(list[0].getAttribute("aria-label")).toBe("Option 1: $10K 3 phase");
    expect(within(list[0]).getByText("Best match")).toBeTruthy();
    expect(within(list[0]).getByRole("link", { name: /See the rules in dollars/ }).getAttribute("href")).toBe("/rules?size=10000&program=3-phase#calculator");
    expect(within(list[0]).getByRole("link", { name: /Plan your risk/ }).getAttribute("href")).toBe("/rules?size=10000&program=3-phase&risk=100&unit=usd#risk-planner");

    fireEvent.click(screen.getByRole("button", { name: "Largest account" }));
    const first = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-label")?.startsWith("Option 1"))!;
    expect(first.getAttribute("aria-label")).toBe("Option 1: $25K 3 phase");
  });

  it("shows the full list and closest options when nothing fits", () => {
    renderFinder("/challenges?fbudget=50&frisk=500");
    expect(screen.getByText("No published plan fits all of your choices.")).toBeTruthy();
    expect(screen.getByText("Closest options")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    fireEvent.click(screen.getByRole("button", { name: /Show all 18 plans that fit/ }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(19);
  });

  it("leaves programs out when switched off, keeping at least one", () => {
    renderFinder();
    const one = screen.getByRole("button", { name: "1 phase" });
    const two = screen.getByRole("button", { name: "2 phase" });
    const three = screen.getByRole("button", { name: "3 phase" });
    fireEvent.click(one);
    expect(one.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("12 of 12 plans fit. Top 3 shown.")).toBeTruthy();
    fireEvent.click(two);
    fireEvent.click(three);
    expect(three.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("6 of 6 plans fit. Top 3 shown.")).toBeTruthy();
    fireEvent.click(one);
    fireEvent.click(two);
    expect(screen.getByText("18 of 18 plans fit. Top 3 shown.")).toBeTruthy();
  });

  it("shows the earliest finish for the days a week you can trade", () => {
    renderFinder("/challenges?fprog=3-phase");
    fireEvent.change(screen.getByLabelText(/Days a week you can trade/), { target: { value: "3" } });
    const first = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-label")?.startsWith("Option 1"))!;
    expect(within(first).getByText("Earliest finish at your pace")).toBeTruthy();
    expect(within(first).getByText("5 weeks+")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show all 6 plans that fit/ }));
    expect(within(screen.getByRole("table")).getByRole("columnheader", { name: "Earliest finish" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect((screen.getByLabelText(/Days a week you can trade/) as HTMLSelectElement).value).toBe("");
  });

  it("rejects text that isn't an amount", () => {
    renderFinder();
    fireEvent.change(screen.getByLabelText(/Most you want to pay/), { target: { value: "cheap" } });
    expect(screen.getByText("Enter an amount in dollars, like 250.")).toBeTruthy();
  });

  it("copies a link to the choices", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderFinder("/challenges?fpri=fastest");
    fireEvent.click(screen.getByRole("button", { name: "Copy a link to these choices" }));
    expect(await screen.findByText("Link copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/challenges\?fpri=fastest#finder$/));
  });
});

describe("challenge finder placement", () => {
  it("sits on the Challenges page with a link from the intro", () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <ChallengesPricing />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "Find your challenge" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find your challenge" }).getAttribute("href")).toBe("#finder");
  });

  it("is linked from the FAQ program answer", () => {
    expect(faqItems.find((f) => f.id === "which-program")?.link?.to).toBe("/challenges#finder");
  });
});
