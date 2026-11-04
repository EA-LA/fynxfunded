import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mock = vi.hoisted(() => ({
  signIn: vi.fn(), signUp: vi.fn(), signInWithGoogle: vi.fn(), signInWithApple: vi.fn(),
  signOut: vi.fn(), sendEmailVerification: vi.fn(), resetPassword: vi.fn(),
  verifyPasswordResetCode: vi.fn(), confirmPasswordReset: vi.fn(), mfaStatus: vi.fn(),
  auth: { currentUser: null as null | { uid: string; email: string; emailVerified: boolean } },
  listener: null as null | ((user: unknown) => Promise<void>),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mock }));
vi.mock('@/lib/firebase', () => ({ auth: mock.auth }));
vi.mock('@/services/security', () => ({ mfaStatus: mock.mfaStatus }));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, callback: (user: unknown) => Promise<void>) => {
    mock.listener = callback;
    return () => { mock.listener = null; };
  },
  verifyPasswordResetCode: mock.verifyPasswordResetCode,
  confirmPasswordReset: mock.confirmPasswordReset,
}));
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

const error = (code: string, message: string) => Object.assign(new Error(message), { code });
const show = (page: React.ReactNode, path = '/login') => render(<MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (button: string) => fireEvent.submit(screen.getByRole('button', { name: button }).closest('form')!);
const fillSignup = () => {
  change('Full Name', '  Alex Trader  '); change('Email', '  Alex@Example.com  '); change('Password', 'Password!1');
};

beforeEach(() => {
  vi.resetAllMocks(); mock.auth.currentUser = null; mock.listener = null;
  mock.signUp.mockResolvedValue({ userId: 'new-user', verificationEmailSent: true });
  mock.sendEmailVerification.mockResolvedValue(undefined);
  mock.verifyPasswordResetCode.mockResolvedValue('alex@example.com');
  mock.mfaStatus.mockResolvedValue({ required: false, verified: true });
});
afterEach(cleanup);

describe('login and email verification recovery', () => {
  it('normalizes email and rejects duplicate password/provider actions while sign-in is pending', async () => {
    let resolve!: () => void;
    mock.signIn.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    show(<Login />); change('Email', '  Alex@Example.com  '); change('Password', 'Password!1');
    submit('Log In'); submit('Please wait…');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(mock.signIn).toHaveBeenCalledExactlyOnceWith('alex@example.com', 'Password!1', undefined);
    expect(mock.signInWithGoogle).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    await act(async () => resolve());
    expect(screen.getByRole('button', { name: 'Log In' })).toBeEnabled();
  });

  it('allows verification email retry without signing out and only confirms a successful send', async () => {
    mock.signIn.mockRejectedValue(error('auth/email-not-verified', 'Verify your email before logging in.'));
    mock.sendEmailVerification.mockRejectedValueOnce(error('auth/network-request-failed', 'network failed')).mockResolvedValueOnce(undefined);
    show(<Login />); change('Email', 'alex@example.com'); change('Password', 'Password!1'); submit('Log In');
    fireEvent.click(await screen.findByRole('button', { name: 'Resend verification email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Verification email sent');
    expect(mock.signOut).not.toHaveBeenCalled();
    expect(mock.signIn).toHaveBeenCalledTimes(1);
  });

  it('restores resend access for an existing unverified session and clears it on an account change', async () => {
    show(<Login />);
    const user = { uid: 'new-user', email: 'alex@example.com', emailVerified: false };
    mock.auth.currentUser = user;
    await act(async () => mock.listener!(user));
    expect(screen.getByLabelText('Email')).toHaveValue('alex@example.com');
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeVisible();
    change('Email', 'someone@example.com');
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).not.toBeInTheDocument();
  });

  it('retains MFA retry after a rejected code and allows a clean restart', async () => {
    mock.signIn.mockRejectedValueOnce(error('auth/two-factor-required', 'Enter your authenticator or recovery code.'))
      .mockRejectedValueOnce(error('functions/permission-denied', 'Code not accepted. Try again.'));
    show(<Login />); change('Email', 'alex@example.com'); change('Password', 'Password!1'); submit('Log In');
    await screen.findByLabelText('Authenticator or recovery code');
    change('Authenticator or recovery code', '123456'); submit('Verify & Log In');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Code not accepted'));
    expect(screen.getByLabelText('Authenticator or recovery code')).toHaveValue('');
    expect(mock.signIn).toHaveBeenLastCalledWith('alex@example.com', '', '123456');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Restart sign-in or use another account' }));
    await waitFor(() => expect(screen.queryByLabelText('Authenticator or recovery code')).not.toBeInTheDocument());
    expect(mock.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('discards a late MFA response from the previous account', async () => {
    let resolve!: (value: unknown) => void;
    mock.mfaStatus.mockReturnValue(new Promise(done => { resolve = done; }));
    show(<Login />);
    const previous = { uid: 'previous', email: 'previous@example.com', emailVerified: true };
    mock.auth.currentUser = previous;
    const pending = mock.listener!(previous);
    mock.auth.currentUser = null;
    await act(async () => mock.listener!(null));
    await act(async () => { resolve({ required: true, verified: false }); await pending; });
    expect(screen.queryByLabelText('Authenticator or recovery code')).not.toBeInTheDocument();
  });
});

describe('signup recovery', () => {
  it('preserves the created account when verification email fails and retries only the email', async () => {
    mock.signUp.mockResolvedValue({ userId: 'new-user', verificationEmailSent: false, verificationEmailError: 'Email is temporarily unavailable.' });
    show(<Signup />, '/signup'); fillSignup(); submit('Create Account');
    expect(await screen.findByRole('heading', { name: 'Your account is created' })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Email is temporarily unavailable');
    expect(mock.signUp).toHaveBeenCalledExactlyOnceWith('alex@example.com', 'Password!1', 'Alex Trader');
    fireEvent.click(screen.getByRole('button', { name: 'Send verification email' }));
    expect(await screen.findByRole('status')).toHaveTextContent("We've sent a verification link");
    expect(mock.signUp).toHaveBeenCalledTimes(1);
    expect(mock.sendEmailVerification).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate creation and uses the same minimum password length as reset', async () => {
    let resolve!: (value: unknown) => void;
    mock.signUp.mockReturnValue(new Promise(done => { resolve = done; }));
    show(<Signup />, '/signup'); fillSignup(); change('Password', 'Short!1'); submit('Create Account');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters');
    expect(mock.signUp).not.toHaveBeenCalled();
    change('Password', 'Password!1'); submit('Create Account'); submit('Please wait…');
    expect(mock.signUp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeDisabled();
    await act(async () => resolve({ userId: 'new-user', verificationEmailSent: true }));
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  it('routes OAuth MFA challenges to login while preserving the requested account destination', async () => {
    mock.signInWithGoogle.mockRejectedValue(error('auth/two-factor-required', 'Enter your authenticator code.'));
    render(<MemoryRouter initialEntries={['/signup?next=%2Ftrade%2Faccess']}><Routes>
      <Route path="/signup" element={<Signup />} /><Route path="/login" element={<Login />} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Welcome back. Log in to your dashboard.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup?next=%2Ftrade%2Faccess');
  });
});

describe('password recovery', () => {
  it('normalizes reset requests, blocks duplicate sending, and gives a non-enumerating confirmation', async () => {
    let resolve!: () => void;
    mock.resetPassword.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    show(<ForgotPassword />, '/forgot-password'); change('Email', '  Alex@Example.com  '); submit('Send Reset Link'); submit('Sending...');
    expect(mock.resetPassword).toHaveBeenCalledExactlyOnceWith('alex@example.com');
    await act(async () => resolve());
    expect(screen.getByRole('status')).toHaveTextContent('If an account uses alex@example.com');
  });

  it('keeps the reset email form retryable on a service failure', async () => {
    mock.resetPassword.mockRejectedValue(error('auth/network-request-failed', 'network failed'));
    show(<ForgotPassword />, '/forgot-password'); change('Email', 'alex@example.com'); submit('Send Reset Link');
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('alex@example.com');
    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeEnabled();
  });

  it('rejects short and mismatched reset passwords before making a request, then accepts one reset only', async () => {
    let resolve!: () => void;
    mock.confirmPasswordReset.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    show(<ResetPassword />, '/reset-password?oobCode=valid-reset');
    await screen.findByLabelText('New Password');
    change('New Password', 'Short!1'); change('Confirm Password', 'Short!1'); submit('Set New Password');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters');
    change('New Password', 'Password!1'); change('Confirm Password', 'Mismatch!1'); submit('Set New Password');
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(mock.confirmPasswordReset).not.toHaveBeenCalled();
    change('Confirm Password', 'Password!1'); submit('Set New Password'); submit('Updating…');
    expect(mock.confirmPasswordReset).toHaveBeenCalledExactlyOnceWith(mock.auth, 'valid-reset', 'Password!1');
    await act(async () => resolve());
    expect(screen.getByRole('status')).toHaveTextContent('Your password has been updated successfully');
  });

  it('offers a fresh link when the reset token is expired and exposes no reset form', async () => {
    mock.verifyPasswordResetCode.mockRejectedValue(error('auth/expired-action-code', 'Expired'));
    show(<ResetPassword />, '/reset-password?oobCode=expired-reset');
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired');
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument();
  });
});
