import { describe, expect, it } from 'vitest';
import { execute, newAccount, type Command } from '../src/tradeDev/engine';
import { candles, marketQuotes } from '../src/tradeDev/market';
const now = Date.UTC(2026, 9, 18, 12);
const seed = () => newAccount({ accountId: 'account_one', userId: 'alice', orderId: 'order_one', challengeId: 'order_one', phase: 1 }, now);
const prices = (bid = 1.1, time = now) => ({ ...marketQuotes(time), EURUSD: { symbol: 'EURUSD' as const, bid, ask: Number((bid + 0.00012).toFixed(5)), time, source: 'synthetic' as const, open: true } });
const buy = (lots = 1): Command => ({ action: 'place', order: { id: 'order_test', symbol: 'EURUSD', side: 'buy', kind: 'market', lots } });
describe('development server execution', () => {
  it('uses ask + adverse tick, contract size, commission and margin', () => {
    const { account } = execute(seed(), buy(), prices(), now);
    expect(account.positions[0].entry).toBe(1.10013); expect(account.balance).toBe(24996.5);
    expect(account.equity).toBe(24983.5); expect(account.margin).toBe(3667.1); expect(account.freeMargin).toBe(21316.4);
    expect(seed().positions).toEqual([]);
  });
  it('closes partial quantities and retains immutable fill records', () => {
    const a = execute(seed(), buy(), prices(), now).account;
    const b = execute(a, { action: 'close', positionId: 'order_test', lots: 0.4 }, prices(1.101), now + 1).account;
    expect(b.positions[0].lots).toBe(0.6); expect(b.history[0].grossPnl).toBe(34.4); expect(b.balance).toBe(25029.5);
    expect(a.history).toHaveLength(0);
    expect(() => execute(b, { action: 'close', positionId: 'order_test', lots: 0.7 }, prices(), now + 2)).toThrow('lot sizes');
  });
  it('limits may improve price but may never fill worse than the requested limit', () => {
    const a = execute(seed(), { action: 'place', order: { id: 'pending_1', symbol: 'EURUSD', side: 'buy', kind: 'limit', lots: 1, price: 1.099 } }, prices(), now).account;
    expect(a.positions).toHaveLength(0); expect(a.orders).toHaveLength(1);
    const b = execute(a, { action: 'tick' }, prices(1.09888), now + 1).account;
    expect(b.positions[0].entry).toBe(1.099); expect(b.orders).toHaveLength(0);
  });
  it('stop orders fill at the current executable price after a gap', () => {
    const a = execute(seed(), { action: 'place', order: { id: 'stop_order', symbol: 'EURUSD', side: 'sell', kind: 'stop', lots: 1, price: 1.099 } }, prices(), now).account;
    const b = execute(a, { action: 'tick' }, prices(1.098), now + 1).account;
    expect(b.positions[0].entry).toBe(1.09799);
  });
  it.each([{ sl: 1.099, bid: 1.098, reason: 'stop_loss' }, { tp: 1.101, bid: 1.102, reason: 'take_profit' }])('processes brackets on server ticks: $reason', ({ sl, tp, bid, reason }) => {
    const command = buy(); if (command.action !== 'place') throw Error('test');
    if (sl) command.order.sl = sl; if (tp) command.order.tp = tp;
    const a = execute(seed(), command, prices(), now).account;
    const b = execute(a, { action: 'tick' }, prices(bid), now + 1).account;
    expect(b.positions).toHaveLength(0); expect(b.history[0].reason).toBe(reason);
  });
  it('fails on equity loss, liquidates and cancels orders, and retains history', () => {
    let a = execute(seed(), buy(2), prices(), now).account;
    a = execute(a, { action: 'place', order: { id: 'pending_2', symbol: 'EURUSD', side: 'buy', kind: 'limit', lots: 1, price: 1.09 } }, prices(), now + 1).account;
    a = execute(a, { action: 'tick' }, prices(1.093), now + 2).account;
    expect(a.status).toBe('failed'); expect(a.positions).toEqual([]); expect(a.orders).toEqual([]); expect(a.history).toHaveLength(1);
    expect(a.history[0].reason).toBe('risk_liquidation'); expect(() => execute(a, buy(), prices(), now + 3)).toThrow('history-only');
  });
  it('passes only when profitable exposure is closed and pending orders are cleared', () => {
    let a = execute(seed(), buy(2), prices(), now).account;
    a = execute(a, { action: 'tick' }, prices(1.111), now + 1).account;
    expect(a.equity).toBeGreaterThan(27000); expect(a.status).toBe('active');
    a = execute(a, { action: 'close', positionId: 'order_test', lots: 2 }, prices(1.111), now + 2).account;
    expect(a.status).toBe('passed'); expect(a.tradingDays).toHaveLength(1);
  });
  it('rejects stale, future, crossed and unavailable prices without mutation', () => {
    expect(() => execute(seed(), buy(), prices(1.1, now - 5001), now)).toThrow('stale');
    expect(() => execute(seed(), buy(), prices(1.1, now + 1), now)).toThrow('stale');
    const q = prices(); q.EURUSD.ask = 1; expect(() => execute(seed(), buy(), q, now)).toThrow('stale');
  });
  it.each([0, -1, 0.001, NaN, Infinity, 11])('rejects invalid lot quantity %s', lots => expect(() => execute(seed(), buy(lots), prices(), now)).toThrow('lot sizes'));
  it('rejects insufficient margin and wrong-side pending orders', () => {
    expect(() => execute(seed(), buy(10), prices(), now)).toThrow('margin');
    expect(() => execute(seed(), { action: 'place', order: { id: 'pending_1', symbol: 'EURUSD', side: 'buy', kind: 'limit', lots: 1, price: 1.2 } }, prices(), now)).toThrow('wrong side');
  });
  it('requires the versioned development account and monotonic timestamps', () => {
    expect(() => execute({ ...seed(), environment: 'production' as any }, buy(), prices(), now)).toThrow('Development');
    expect(() => execute(seed(), buy(), prices(), now - 1)).toThrow('Out-of-order');
  });
  it('builds candles only from the synthetic adapter with ordered timestamps', () => {
    for (const period of [60, 300, 900]) {
      const rows = candles('EURUSD', period, now); expect(rows).toHaveLength(120);
      expect(rows.every((r, i) => r.high >= Math.max(r.open, r.close) && r.low <= Math.min(r.open, r.close) && (i === 0 || r.time > rows[i-1].time))).toBe(true);
    }
  });
});
