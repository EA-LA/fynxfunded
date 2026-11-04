import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
const mock = vi.hoisted(() => ({ access: vi.fn(), signOut: vi.fn(), user: null as any, loading: false }));
vi.mock('@/services/private-funded', () => ({ checkPrivateFundedAccess: mock.access }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ ...mock }) }));
import ProtectedRoute from '@/components/ProtectedRoute';
import Account from '@/pages/Account';
const user = (id: string, emailVerified = true) => ({ userId: id, email: `${id}@example.invalid`, fullName: id, emailVerified });
const Where = () => { const location = useLocation(); return <p data-testid="location">{location.pathname}{location.search}</p>; };
const tree = (accountOnly = false, path = '/dashboard') => <MemoryRouter initialEntries={[path]}><Where /><Routes>
  <Route path="/dashboard" element={<ProtectedRoute accountOnly={accountOnly}><p>Private funded data</p></ProtectedRoute>} />
  <Route path="/account" element={<ProtectedRoute accountOnly><Account /></ProtectedRoute>} />
  <Route path="/login" element={<p>Login screen</p>} />
</Routes></MemoryRouter>;
beforeEach(() => {
  vi.resetAllMocks(); mock.user = user('customer'); mock.loading = false;
  vi.stubEnv('VITE_FYNX_TRADE_DEV', 'false');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('authenticated customer and private Funded access', () => {
  it('allows verified customers into account-only routes without asking for private access', () => {
    render(tree(false, '/account'));
    expect(screen.getByRole('heading', { name: 'Welcome, customer' })).toBeVisible();
    expect(screen.getByText('customer@example.invalid')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Purchases and trading are paused' })).toBeVisible();
    expect(mock.access).not.toHaveBeenCalled();
  });
  it.each([null, user('unverified', false)])('sends missing or unverified identities to login with a return path', (identity) => {
    mock.user = identity; render(tree(false, '/account'));
    expect(screen.getByText('Login screen')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Faccount');
    expect(mock.access).not.toHaveBeenCalled();
  });
  it('redirects authenticated customers to their account when private access is denied', async () => {
    mock.access.mockRejectedValue(Object.assign(new Error('Private access only'), { code: 'functions/permission-denied' }));
    render(tree());
    expect(await screen.findByRole('heading', { name: 'Welcome, customer' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/account');
    expect(screen.queryByText('Private funded data')).not.toBeInTheDocument();
  });
  it('keeps private data hidden on network failure and allows an explicit retry', async () => {
    mock.access.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'functions/unavailable' }))
      .mockResolvedValueOnce({ authorized: true, ownerUID: 'customer', expiresAt: Date.now() + 60_000 });
    render(tree());
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t check Funded access');
    expect(screen.queryByText('Private funded data')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my account' })).toHaveAttribute('href', '/account');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Private funded data')).toBeVisible();
    expect(mock.access).toHaveBeenCalledTimes(2);
  });
  it('renders private data only for an unexpired matching owner grant', async () => {
    mock.access.mockResolvedValue({ authorized: true, ownerUID: 'someone-else', expiresAt: Date.now() + 60_000 });
    render(tree());
    await waitFor(() => expect(mock.access).toHaveBeenCalledOnce());
    expect(screen.queryByText('Private funded data')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking Funded access');
  });
  it('discards an outstanding grant when the signed-in identity switches', async () => {
    let resolvePrevious!: (value: unknown) => void;
    mock.access.mockReturnValueOnce(new Promise(done => { resolvePrevious = done; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const view = render(tree());
    await waitFor(() => expect(mock.access).toHaveBeenCalledOnce());
    mock.user = user('next'); view.rerender(tree());
    await waitFor(() => expect(mock.access).toHaveBeenCalledTimes(2));
    await act(async () => resolvePrevious({ authorized: true, ownerUID: 'customer', expiresAt: Date.now() + 60_000 }));
    expect(screen.queryByText('Private funded data')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking Funded access');
  });
  it('hides an existing grant immediately when the identity switches', async () => {
    mock.access.mockResolvedValueOnce({ authorized: true, ownerUID: 'customer', expiresAt: Date.now() + 60_000 })
      .mockImplementationOnce(() => new Promise(() => {}));
    const view = render(tree());
    await screen.findByText('Private funded data');
    mock.user = user('next'); view.rerender(tree());
    expect(screen.queryByText('Private funded data')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking Funded access');
  });
  it('shows account signout failure and allows a retry without claiming the session ended', async () => {
    mock.signOut.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'auth/network-request-failed' })).mockResolvedValueOnce(undefined);
    render(tree(false, '/account'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mock.signOut).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
