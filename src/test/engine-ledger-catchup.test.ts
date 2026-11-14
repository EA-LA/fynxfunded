import { describe, expect, it } from "vitest";
import type { Deal } from "@/engine/types";
import { catchUpLedger, EngineLedger, firestoreTradeWriter } from "@/engine/ledger";
import { FOREX_PAIRS } from "@/trade-access/instruments";

// Test values only: these deals exercise the plumbing and are not market prices or real results.
const T0 = Date.parse("2026-11-04T10:00:00Z");
const DAY = 86_400_000;
const pipSize = (s: string) => FOREX_PAIRS.find(p => p.symbol === s)?.pipSize;

const deal = (id: string, closedAt: number): Deal => ({
  id, positionId: `p-${id}`, symbol: "EURUSD", side: "buy", lots: 1, entryPrice: 1.08, exitPrice: 1.081,
  openedAt: closedAt - 60_000, closedAt, grossProfit: 100, commission: 7, netProfit: 93, reason: "manual",
});

function trades() {
  const docs = new Map<string, Record<string, unknown>>();
  const db = { collection: (c: string) => ({ doc: (id: string) => ({ async create(d: Record<string, unknown>) {
    if (docs.has(`${c}/${id}`)) throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 });
    docs.set(`${c}/${id}`, structuredClone(d));
  } }) }) };
  return { docs, writer: firestoreTradeWriter(db) };
}

const ledgerFor = (writer: ReturnType<typeof trades>["writer"]) =>
  new EngineLedger({ writer, owner: async () => ({ userId: "u1", challengeId: "ch1" }), pipSize, clock: () => T0, sleep: async () => {} });

describe("catchUpLedger (re-send recent closed trades after a restart)", () => {
  it("writes trades that never reached the dashboard and leaves the ones already there untouched", async () => {
    const t = trades();
    // Before the stop: d1 was written, d2 closed but the process stopped before its write.
    const first = ledgerFor(t.writer);
    first.record("acc1", deal("d1", T0 - 2 * 60_000));
    await first.flush();
    expect(t.docs.size).toBe(1);
    const firstRecord = structuredClone(t.docs.get("trades/fynxtrade_acc1_d1"));

    // After the restart: a new ledger with empty memory.
    const ledger = ledgerFor(t.writer);
    const report = await catchUpLedger({
      ledger, accounts: async () => ["acc1"], since: T0 - 7 * DAY,
      load: async () => ({ history: [deal("d1", T0 - 2 * 60_000), deal("d2", T0 - 60_000)] }),
    });
    await ledger.flush();
    expect(report).toMatchObject({ accounts: 1, checked: 1, dealsSent: 2, capped: false, cancelled: false, unreadable: [], listError: null });
    expect([...t.docs.keys()].sort()).toEqual(["trades/fynxtrade_acc1_d1", "trades/fynxtrade_acc1_d2"]);
    expect(t.docs.get("trades/fynxtrade_acc1_d1")).toEqual(firstRecord); // never overwritten
    expect(ledger.health()).toMatchObject({ written: 1, alreadyRecorded: 1, failed: [] });
  });

  it("only looks back to `since`, keeps the newest per account and in total, and says when it capped", async () => {
    const t = trades();
    const ledger = ledgerFor(t.writer);
    const history = [deal("old", T0 - 10 * DAY), ...Array.from({ length: 5 }, (_, i) => deal(`n${i}`, T0 - (5 - i) * 60_000))];
    const report = await catchUpLedger({
      ledger, accounts: async () => ["a", "b", "a"], since: T0 - 7 * DAY, maxDealsPerAccount: 3, maxDeals: 4,
      load: async () => ({ history }),
    });
    await ledger.flush();
    expect(report).toMatchObject({ accounts: 2, checked: 2, dealsSent: 4, capped: true });
    const keys = [...t.docs.keys()].sort();
    expect(keys).toEqual(["trades/fynxtrade_a_n2", "trades/fynxtrade_a_n3", "trades/fynxtrade_a_n4", "trades/fynxtrade_b_n4"]);
    expect(keys.some(k => k.endsWith("_old"))).toBe(false);
  });

  it("carries on past an account it cannot read, reports a failed account list, and stops when the host stops", async () => {
    const t = trades();
    const ledger = ledgerFor(t.writer);
    const partial = await catchUpLedger({
      ledger, accounts: async () => ["bad", "missing", "good"], since: 0,
      load: async id => {
        if (id === "bad") throw new Error("deadline exceeded\nstack…");
        return id === "missing" ? null : { history: [deal("g1", T0)] };
      },
    });
    await ledger.flush();
    expect(partial).toMatchObject({ accounts: 3, checked: 2, dealsSent: 1, unreadable: [{ accountId: "bad", error: "deadline exceeded" }] });
    expect(t.docs.has("trades/fynxtrade_good_g1")).toBe(true);

    const listFailed = await catchUpLedger({ ledger, accounts: async () => { throw new Error("permission denied"); }, load: async () => null, since: 0 });
    expect(listFailed).toMatchObject({ accounts: 0, checked: 0, listError: "permission denied" });

    let reads = 0;
    const stopped = await catchUpLedger({ ledger, accounts: async () => ["x", "y", "z"], since: 0, cancelled: () => reads >= 1, load: async () => { reads++; return { history: [] }; } });
    expect(stopped).toMatchObject({ checked: 1, cancelled: true });
  });
});
