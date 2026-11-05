import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { accountLimits, tradeAccessError } from '../trade-access/account-limits';
import { MARKET_GROUPS } from '../trade-access/MarketChart';

const call = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' }, signOut: vi.fn(async () => {}) }) }));
vi.mock('@/services/funded-access', () => ({ fundedAccessCall: call }));
vi.mock('@/components/ThemeToggle', () => ({ default: () => null }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }));
import TradeAccess from '../trade-access/TradeAccess';

const rules = { profit_target_percent: '8', daily_loss_percent: '5', max_loss_percent: '10', min_trading_days: 4 };
const account = { accountId: 'ft_abcdef1234567890_p1', challengeId: 'c1', orderId: 'o1', platform: 'FYNX Trade', status: 'active', activationStatus: 'active', currentPhase: 1, startingBalance: 50000, balance: 51000, equity: 51000, tradingEnabled: false, tradingHoldReason: '', access: 'view_only', accountEmailStatus: 'delivered', rules };

describe('account limits in dollars', () => {
  it('turns the recorded rule snapshot into target, loss allowance and floor', () => {
    expect(accountLimits(50000, 51000, rules)).toEqual({ targetProfit: 4000, targetBalance: 54000, dailyLossAllowance: 2500, maxLossAllowance: 5000, maxLossFloor: 45000, profitSoFar: 1000, targetProgress: 0.25, roomToMaxFloor: 6000 });
  });
  it('clamps progress and refuses malformed rules', () => {
    expect(accountLimits(50000, 49000, rules)?.targetProgress).toBe(0);
    expect(accountLimits(50000, 60000, rules)?.targetProgress).toBe(1);
    expect(accountLimits(50000, 50000, { ...rules, max_loss_percent: 'x' })).toBeNull();
    expect(accountLimits(0, 0, rules)).toBeNull();
  });
});

describe('trade access errors', () => {
  it('explains the private-testing gate instead of showing a raw code', () => {
    const r = tradeAccessError({ code: 'functions/permission-denied', message: 'FYNX Funded is currently restricted to authorized private testing.' });
    expect(r.kind).toBe('private');expect(r.message).not.toMatch(/403/);
    expect(tradeAccessError({ code: 'functions/unauthenticated' }).kind).toBe('signin');
    expect(tradeAccessError({ code: 'functions/internal', message: 'internal' }).message).toBe('Account access could not be loaded. Please retry.');
  });
});

describe('market picker', () => {
  it('offers forex, metals, indices and crypto with unique symbols', () => {
    const ids = MARKET_GROUPS.flatMap(g => g.markets.map(m => m[0]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(ids).toContain('FX:EURUSD');
  });
});

describe('FYNX Trade workspace', () => {
  beforeEach(() => { call.mockReset(); localStorage.clear(); });
  it('shows the account in dollars with the reset countdown and planner link', async () => {
    call.mockImplementation(async (_n: string, d: { action: string }) => d.action === 'list' ? { accounts: [account] } : account);
    render(<MemoryRouter><TradeAccess /></MemoryRouter>);
    expect(await screen.findByText('Target balance')).toBeInTheDocument();
    expect(screen.getByText('$54,000.00')).toBeInTheDocument();
    expect(screen.getByText('$45,000.00')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progress to profit target' })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(/Next daily reset in/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan your risk per trade for this account' })).toHaveAttribute('href', expect.stringContaining('size=50000'));
  });
  it('shows private-testing guidance, not an error code, when access is gated', async () => {
    call.mockRejectedValue(Object.assign(new Error('FYNX Funded is currently restricted to authorized private testing.'), { code: 'functions/permission-denied' }));
    render(<MemoryRouter><TradeAccess /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/FYNX Trade is in private testing/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out and sign in again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1h' })).toBeInTheDocument();
  });
});
