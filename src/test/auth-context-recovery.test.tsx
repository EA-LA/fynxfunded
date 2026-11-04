import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
const mock = vi.hoisted(() => ({
  listener: null as any, signIn: vi.fn(), signUp: vi.fn(), signInWithGoogle: vi.fn(),
  handleRedirectResult: vi.fn(), refreshCurrentUser: vi.fn(), signOut: vi.fn(),
}));
vi.mock('@/services/auth', () => ({ authService: {
  ...mock,
  onAuthStateChange: (listener: any) => { mock.listener = listener; listener(null); return () => { mock.listener = null; }; },
} }));
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
const customer = { userId: 'customer', email: 'customer@example.invalid', emailVerified: true };
function Probe() {
  const auth = useAuth(), location = useLocation();
  const [result, setResult] = React.useState('');
  return <>
    <p data-testid="user">{auth.user?.userId || 'signed out'}</p>
    <p data-testid="location">{location.pathname}{location.search}</p>
    <p data-testid="signup-result">{result}</p>
    <button onClick={() => auth.signIn('customer@example.invalid', 'Password!1')}>Sign in</button>
    <button onClick={() => auth.signUp('customer@example.invalid', 'Password!1', 'Customer').then(value => setResult(String(value.verificationEmailSent)))}>Sign up</button>
    <button onClick={() => auth.signInWithGoogle()}>Google</button>
  </>;
}
const show = (path: string) => {
  window.history.replaceState(null, '', path);
  return render(<BrowserRouter><AuthProvider><Probe /></AuthProvider></BrowserRouter>);
};
beforeEach(() => { vi.resetAllMocks(); mock.listener = null; mock.handleRedirectResult.mockResolvedValue(null); vi.stubEnv('VITE_FYNX_TRADE_DEV', 'false'); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState(null, '', '/'); });

describe('auth context session publication', () => {
  it('publishes a completed sign-in even when no token callback follows it', async () => {
    mock.signIn.mockResolvedValue(customer); show('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('customer'));
    expect(screen.getByTestId('location')).toHaveTextContent('/account');
  });
  it('preserves a safe requested destination after sign-in', async () => {
    mock.signIn.mockResolvedValue(customer); show('/login?next=%2Ftrade%2Faccess%3Faccount%3Dexample');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/trade/access?account=example'));
  });
  it('returns signup delivery state without publishing the unverified identity', async () => {
    mock.signUp.mockResolvedValue({ ...customer, emailVerified: false, verificationEmailSent: false }); show('/signup');
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() => expect(screen.getByTestId('signup-result')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('signed out');
    expect(screen.getByTestId('location')).toHaveTextContent('/signup');
  });
  it('keeps password reset links available to an already authenticated user', async () => {
    show('/reset-password?oobCode=reset-code');
    await act(async () => mock.listener(customer));
    expect(screen.getByTestId('location')).toHaveTextContent('/reset-password?oobCode=reset-code');
  });
  it('does not publish the empty result used while OAuth redirects out of the browser', async () => {
    mock.signInWithGoogle.mockResolvedValue({}); show('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    await waitFor(() => expect(mock.signInWithGoogle).toHaveBeenCalledOnce());
    expect(screen.getByTestId('user')).toHaveTextContent('signed out');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });
});
