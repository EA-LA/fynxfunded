import { beforeEach, describe, expect, it, vi } from "vitest";

const { addAuditLog } = vi.hoisted(() => ({
  addAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/database", () => ({ dataService: { addAuditLog } }));

import { evaluateRules, type EquityPoint, type TradeRecord, type TradingDataProvider } from "@/services/rules-engine";

const rules = { accountSize: 10_000, profitTargetPct: 8, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 5 };

function trade(day: number, pnl: number): TradeRecord {
  const date = `2026-09-${String(day).padStart(2, "0")}T16:00:00.000Z`;
  return { tradeId: `trade-${day}`, symbol: "EURUSD", type: "buy", openTime: date, closeTime: date, lots: 1, pnl, commission: 0 };
}

function provider(trades: TradeRecord[], equity: EquityPoint[] = []): TradingDataProvider {
  return {
    getTrades: vi.fn().mockResolvedValue(trades),
    getEquityTimeline: vi.fn().mockResolvedValue(equity),
    getBalanceTimeline: vi.fn().mockResolvedValue([]),
    getDailyPnL: vi.fn().mockResolvedValue(null),
    getDailyPnLRange: vi.fn().mockResolvedValue([]),
  };
}

describe("challenge rules engine", () => {
  beforeEach(() => addAuditLog.mockClear());

  it("automatically passes an account that meets target and trading days", async () => {
    const result = await evaluateRules("account-1", rules, provider([
      trade(1, 200), trade(2, 200), trade(3, 200), trade(4, 100), trade(5, 100),
    ]));
    expect(result.status).toBe("passed");
    expect(result.tradingDays).toBe(5);
    expect(result.profitPct).toBe(8);
    expect(result.violations).toHaveLength(0);
    expect(addAuditLog).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", result: "passed" }));
  });

  it("keeps an incomplete account active", async () => {
    const result = await evaluateRules("account-2", rules, provider([trade(1, 100), trade(2, 100)]));
    expect(result.status).toBe("active");
    expect(result.evaluations.find((item) => item.rule === "profit_target")?.result).toBe("warning");
    expect(result.evaluations.find((item) => item.rule === "min_trading_days")?.result).toBe("warning");
  });

  it("automatically fails a daily loss breach", async () => {
    const result = await evaluateRules("account-3", rules, provider([trade(1, -501)]));
    expect(result.status).toBe("failed");
    expect(result.violations.map((item) => item.rule)).toContain("daily_drawdown");
  });

  it("automatically fails a maximum drawdown breach", async () => {
    const equity = [
      { timestamp: "2026-09-01T12:00:00Z", balance: 10_500, equity: 10_500 },
      { timestamp: "2026-09-02T12:00:00Z", balance: 9_499, equity: 9_499 },
    ];
    const result = await evaluateRules("account-4", rules, provider([], equity));
    expect(result.status).toBe("failed");
    expect(result.maxDrawdownPct).toBeCloseTo(10.01);
    expect(result.violations.map((item) => item.rule)).toContain("max_drawdown");
  });

  it("allows losses exactly on the configured limits", async () => {
    const equity = [{ timestamp: "2026-09-01T12:00:00Z", balance: 9_000, equity: 9_000 }];
    const result = await evaluateRules("account-5", rules, provider([trade(1, -500)], equity));
    expect(result.status).toBe("active");
    expect(result.dailyDrawdownPct).toBe(5);
    expect(result.maxDrawdownPct).toBe(10);
    expect(result.violations).toHaveLength(0);
  });
});
