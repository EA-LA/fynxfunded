import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const fake = vi.hoisted(() => ({ uid: 'owner', get: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { userId: fake.uid } }) }));
vi.mock('@/services/funded-operations', () => ({ getFundedOperations: fake.get }));
import FundedOperations from '@/components/FundedOperations';
const report = { status: 'attention', checkedAt: new Date().toISOString(), readAt: new Date().toISOString(), complete: true, orders: 4, findingsTotal: 1, findingsTruncated: false, findings: [{ orderId: 'owned-order', reason: 'account_pending' }], states: {}, freshnessMinutes: 120, providerReconciliation: false, purchasesPaused: true, progressionPaused: true };
beforeEach(() => { cleanup(); fake.uid = 'owner'; fake.get.mockReset(); });
it('shows setup findings and launch holds without implying broker readiness', async () => {
  fake.get.mockResolvedValue(report); render(<FundedOperations/>);
  await screen.findByText('owned-order'); expect(screen.getAllByText('Paused')).toHaveLength(2); expect(screen.getByText('Not connected')).toBeTruthy(); expect(screen.getByText('Paid order awaiting account setup')).toBeTruthy();
});
it('labels missing or stale reports honestly and offers retry after a network failure', async () => {
  fake.get.mockRejectedValueOnce(Error('offline')).mockResolvedValue({ ...report, status: 'stale' }); render(<FundedOperations/>);
  await screen.findByRole('alert'); fireEvent.click(screen.getByText('Refresh operations'));
  await screen.findByText('Reconciliation needs a fresh run'); expect(screen.queryByText('No internal exceptions in the latest scan')).toBeNull();
});
it('never renders an old owner response after the session changes', async () => {
  let finish: (value: unknown) => void = () => {};
  fake.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ...report, findings: [] });
  const view = render(<FundedOperations/>); fake.uid = 'different-owner'; view.rerender(<FundedOperations/>);
  await screen.findByText('Reconciliation needs attention'); finish(report);
  await waitFor(() => expect(screen.queryByText('owned-order')).toBeNull());
});
