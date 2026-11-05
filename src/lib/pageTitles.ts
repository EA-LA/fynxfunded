/**
 * Browser-tab names for pages that are not in the search-engine list (they stay
 * noindex). Without these every such page was titled "Account".
 */
const privateTitles: [RegExp, string][] = [
  [/^\/login\/?$/, 'Log in'],
  [/^\/signup\/?$/, 'Create your account'],
  [/^\/forgot-password\/?$/, 'Reset your password'],
  [/^\/reset-password\/?$/, 'Choose a new password'],
  [/^\/verification\/?$/, 'Identity verification'],
  [/^\/certificates\/verify(\/.*)?$/, 'Verify a certificate'],
  [/^\/challenge-builder\/?$/, 'Build your challenge'],
  [/^\/checkout\/success\/?$/, 'Order received'],
  [/^\/checkout\/failure\/?$/, 'Payment not completed'],
  [/^\/checkout\/?$/, 'Checkout'],
  [/^\/order-status\/?$/, 'Order status'],
  [/^\/trade(\/.*)?$/, 'FYNX Trade'],
  [/^\/admin(\/.*)?$/, 'Admin'],
  [/^\/account\/?$/, 'Account'],
  [/^\/dashboard\/accounts\/[^/]+\/?$/, 'Account workspace'],
  [/^\/dashboard\/accounts\/?$/, 'Accounts · Dashboard'],
  [/^\/dashboard\/analytics\/?$/, 'Analytics · Dashboard'],
  [/^\/dashboard\/trades\/?$/, 'Trades · Dashboard'],
  [/^\/dashboard\/objectives\/?$/, 'Objectives · Dashboard'],
  [/^\/dashboard\/payouts\/?$/, 'Payouts · Dashboard'],
  [/^\/dashboard\/billing\/?$/, 'Billing · Dashboard'],
  [/^\/dashboard\/certificates\/?$/, 'Certificates · Dashboard'],
  [/^\/dashboard\/learning\/?$/, 'Learning · Dashboard'],
  [/^\/dashboard\/resources\/?$/, 'Resources · Dashboard'],
  [/^\/dashboard\/settings\/?$/, 'Settings · Dashboard'],
  [/^\/dashboard\/support\/?$/, 'Support · Dashboard'],
  [/^\/dashboard(\/.*)?$/, 'Dashboard'],
];

/** Tab name for a page that is not listed for search engines. */
export function privatePageTitle(pathname: string): string {
  return privateTitles.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Account';
}
