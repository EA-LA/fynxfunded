// Firebase uses one email callback for both products. Only forward codes to owned handlers.
export function emailActionRedirect(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get('oobCode')) return null;
  let origin = '';
  try { origin = new URL(params.get('continueUrl') || '').origin; } catch { /* Old Funded links have no state. */ }
  let target: URL;
  if (['https://www.fynxfinanceworld.com', 'https://fynxfinanceworld.com'].includes(origin)) {
    target = new URL('https://www.fynxfinanceworld.com/auth/action.html');
    target.searchParams.set('continueUrl', 'https://www.fynxfinanceworld.com/auth/login.html');
  } else if (['verifyEmail', 'recoverEmail', 'revertSecondFactorAddition', 'verifyAndChangeEmail'].includes(params.get('mode') || '')) {
    target = new URL('https://fynx-c7a28.firebaseapp.com/__/auth/action');
    target.searchParams.set('continueUrl', 'https://fynxfunded.com/login');
  } else {
    return null;
  }
  for (const key of ['mode', 'oobCode', 'apiKey', 'lang']) {
    const value = params.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target.href;
}
