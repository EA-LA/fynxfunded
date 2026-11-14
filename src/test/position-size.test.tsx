import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import PositionSizeCalculator from "@/components/PositionSizeCalculator";
import RulesPage from "@/pages/Rules";
import { I18nProvider } from "@/lib/i18n";
import { faqItems } from "@/lib/faqContent";
import { parsePositionPreset, positionSizeLink, sizePosition, unitValuePerLot } from "@/lib/positionSize";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = { commissionPerLot: 0, rewardRatio: 2, dailyAllowance: 1250, accountSize: 25000 };

describe("position size maths", () => {
  it("uses standard contract conventions for the dollar value of a pip", () => {
    expect(unitValuePerLot("xxxusd")).toBe(10);
    expect(unitValuePerLot("usdxxx", 1.25)).toBe(8);
    expect(unitValuePerLot("usdjpy", 125)).toBe(8);
    expect(unitValuePerLot("xauusd")).toBe(100);
    expect(unitValuePerLot("custom", undefined, 1)).toBe(1);
    expect(() => unitValuePerLot("usdjpy")).toThrow();
    expect(() => unitValuePerLot("custom")).toThrow();
  });

  it("converts cross-pair pips into dollars with the matching US-dollar pair", () => {
    // GBP/JPY: 1,000 JPY per pip ÷ USD/JPY 125 = $8.
    expect(unitValuePerLot("cross", 125, undefined, "JPY")).toBe(8);
    // EUR/GBP: 10 GBP per pip × GBP/USD 1.25 = $12.50.
    expect(unitValuePerLot("cross", 1.25, undefined, "GBP")).toBe(12.5);
    // EUR/CAD: 10 CAD per pip ÷ USD/CAD 1.25 = $8.
    expect(unitValuePerLot("cross", 1.25, undefined, "CAD")).toBe(8);
    // AUD/NZD: 10 NZD per pip × NZD/USD 0.6 = $6.
    expect(unitValuePerLot("cross", 0.6, undefined, "NZD")).toBe(6);
    expect(() => unitValuePerLot("cross", undefined, undefined, "JPY")).toThrow();
    const r = sizePosition({ ...base, riskAmount: 125, kind: "cross", quote: "GBP", stopDistance: 20, price: 1.25 });
    // $125 / (20 × $12.50) = 0.50 lots.
    expect(r).toMatchObject({ lots: 0.5, units: 50000, totalLoss: 125 });
  });

  it("keeps the cross pair's second currency in shared links", () => {
    const link = positionSizeLink({ accountSize: 25000, kind: "cross", quote: "CHF", stop: 15, price: 0.88 });
    expect(link).toBe("/rules?size=25000&inst=cross&qc=CHF&stop=15&px=0.88#position-size");
    expect(parsePositionPreset(new URLSearchParams(link.split("?")[1].split("#")[0]))).toMatchObject({ kind: "cross", quote: "CHF", priceInput: "0.88", stopInput: "15" });
    expect(parsePositionPreset(new URLSearchParams("inst=cross&qc=xyz")).quote).toBe("JPY");
    expect(parsePositionPreset(new URLSearchParams("inst=cross&qc=gbp")).quote).toBe("GBP");
  });

  it("sizes a EUR/USD trade so a stop-out equals the chosen risk", () => {
    const r = sizePosition({ ...base, riskAmount: 125, kind: "xxxusd", stopDistance: 25 });
    expect(r).toMatchObject({ lots: 0.5, units: 50000, totalLoss: 125, unusedRisk: 0, lossPercentOfAccount: 0.5, lossPercentOfDaily: 10, lossesToDailyFloor: 10, targetDistance: 50, targetProfit: 250, belowMinimumLot: false });
  });

  it("rounds down so the loss never goes over the risk, and includes charges", () => {
    // $100 risk, 30-pip stop, $7 round-turn charge: 100 / (300 + 7) = 0.3257 → 0.32 lots.
    const r = sizePosition({ ...base, riskAmount: 100, kind: "xxxusd", stopDistance: 30, commissionPerLot: 7 });
    expect(r.lots).toBe(0.32);
    expect(r.stopLoss).toBe(96);
    expect(r.commission).toBe(2.24);
    expect(r.totalLoss).toBe(98.24);
    expect(r.totalLoss).toBeLessThanOrEqual(100);
    expect(r.unusedRisk).toBe(1.76);
    // Profit at 2x: 0.32 × 60 pips × $10 − charges.
    expect(r.targetProfit).toBe(189.76);
  });

  it("handles gold, prices typed by the trader and too-small risk", () => {
    const gold = sizePosition({ ...base, riskAmount: 250, kind: "xauusd", stopDistance: 5 });
    expect(gold).toMatchObject({ lots: 0.5, units: 50, totalLoss: 250 });
    const jpy = sizePosition({ ...base, riskAmount: 200, kind: "usdjpy", stopDistance: 20, price: 125 });
    expect(jpy).toMatchObject({ lots: 1.25, totalLoss: 200 });
    const tiny = sizePosition({ ...base, riskAmount: 5, kind: "xauusd", stopDistance: 10 });
    expect(tiny).toMatchObject({ lots: 0, belowMinimumLot: true, minimumLotLoss: 10 });
    const custom = sizePosition({ ...base, riskAmount: 300, kind: "custom", stopDistance: 40, customValue: 1 });
    expect(custom.lots).toBe(7.5);
    expect(custom.units).toBeUndefined();
  });

  it("rejects nonsense input", () => {
    expect(() => sizePosition({ ...base, riskAmount: 0, kind: "xxxusd", stopDistance: 10 })).toThrow();
    expect(() => sizePosition({ ...base, riskAmount: 100, kind: "xxxusd", stopDistance: -1 })).toThrow();
    expect(() => sizePosition({ ...base, riskAmount: 100, kind: "xxxusd", stopDistance: 10, commissionPerLot: -2 })).toThrow();
  });

  it("reads and writes shareable links, ignoring bad values", () => {
    const link = positionSizeLink({ accountSize: 50000, program: "1-phase", riskMode: "dollars", riskValue: 250, kind: "usdjpy", stop: 15, price: 150.25, commission: 7, rewardRatio: 3 });
    expect(link).toBe("/rules?size=50000&program=1-phase&risk=250&unit=usd&inst=usdjpy&stop=15&px=150.25&comm=7&rr=3#position-size");
    const parsed = parsePositionPreset(new URLSearchParams(link.split("?")[1].split("#")[0]));
    expect(parsed).toMatchObject({ accountSize: 50000, program: "1-phase", riskMode: "dollars", riskInput: "250", kind: "usdjpy", stopInput: "15", priceInput: "150.25", commissionInput: "7", rewardRatio: 3 });
    const bad = parsePositionPreset(new URLSearchParams("size=123&inst=nope&stop=-4&risk=500&rr=9&comm=abc"));
    expect(bad).toMatchObject({ accountSize: 25000, kind: "xxxusd", stopInput: "20", riskInput: "0.5", rewardRatio: 2, commissionInput: "0" });
    // A price is only kept for instruments that need one.
    expect(positionSizeLink({ accountSize: 10000, kind: "xxxusd", stop: 10, price: 1.1 })).toBe("/rules?size=10000&inst=xxxusd&stop=10#position-size");
  });
});

const renderAt = (url: string, ui = <PositionSizeCalculator />) =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </I18nProvider>,
  );

describe("position size calculator", () => {
  it("shows the lot size and loss for the default plan and reacts to changes", () => {
    renderAt("/rules");
    // $25K, 0.5% = $125, 20 pips on EUR/USD → 0.62 lots.
    expect(screen.getByTestId("ps-lots")).toHaveTextContent("0.62 lots");
    expect(screen.getByTestId("ps-loss")).toHaveTextContent("$124.00");
    fireEvent.change(screen.getByLabelText(/Stop-loss distance/), { target: { value: "25" } });
    expect(screen.getByTestId("ps-lots")).toHaveTextContent("0.50 lots");
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "usdjpy" } });
    // Needs the trader's own price before it can size the trade.
    expect(screen.queryByTestId("ps-lots")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Current price"), { target: { value: "125" } });
    // $125 / (25 × $8) = 0.625 → 0.62.
    expect(screen.getByTestId("ps-lots")).toHaveTextContent("0.62 lots");
  });

  it("sizes a cross pair once the trader types the US-dollar pair's price", () => {
    renderAt("/rules?size=25000&risk=125&unit=usd&stop=25");
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "cross" } });
    expect(screen.getByTestId("ps-cross-help")).toHaveTextContent("1,000 JPY per pip on 1.00 lot");
    expect(screen.queryByTestId("ps-lots")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Current USD/JPY price"), { target: { value: "125" } });
    // $125 / (25 × $8) = 0.625 → 0.62.
    expect(screen.getByTestId("ps-lots")).toHaveTextContent("0.62 lots");
    // A different second currency needs a different price, so the old one is cleared.
    fireEvent.click(screen.getByRole("button", { name: "GBP" }));
    expect(screen.getByLabelText("Current GBP/USD price")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Current GBP/USD price"), { target: { value: "1.25" } });
    // $125 / (25 × $12.50) = 0.40.
    expect(screen.getByTestId("ps-lots")).toHaveTextContent("0.40 lots");
  });

  it("opens on a shared calculation and warns when the risk is below one minimum lot", () => {
    renderAt("/rules?size=5000&risk=5&unit=usd&inst=xauusd&stop=10#position-size");
    expect(screen.getByTestId("ps-too-small")).toHaveTextContent("$10.00");
  });

  it("copies a link to the calculation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderAt("/rules?size=100000&program=1-phase&risk=400&unit=usd&stop=40");
    fireEvent.click(screen.getByRole("button", { name: /Copy a link to this calculation/ }));
    await screen.findByText("Link copied");
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rules?size=100000&program=1-phase&risk=400&unit=usd&inst=xxxusd&stop=40&rr=2#position-size`);
  });

  it("is on the Rules page, linked from the planner and the FAQ", () => {
    renderAt("/rules?size=50000&program=3-phase&risk=1", <RulesPage />);
    expect(screen.getByRole("heading", { name: "Position size calculator" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Turn your risk into a lot size" })).toHaveAttribute("href", "#position-size");
    expect(screen.getByRole("link", { name: /Turn this risk into a lot size/ })).toHaveAttribute("href", "/rules?size=50000&program=3-phase&risk=1&rr=2#position-size");
    expect(faqItems.find((i) => i.id === "lot-size")?.link?.to).toBe("/rules#position-size");
  });
});
