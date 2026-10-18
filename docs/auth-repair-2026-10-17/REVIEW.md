# FYNX Funded authentication repair

Prepared October 17, 2026. Not deployed.

## Confirmed causes

1. Firebase 13 callable errors append the HTTP status, producing the exact screenshot text `Server verification is awaiting activation. [400]`. The compatibility handler compared the message to the older string without the suffix, so verified non-MFA users could not finish login.
2. Signup created the Firebase identity and sent verification, then attempted to create a security-settings document without `twoFactorEnabled`. The currently deployed Firestore rules require that field, so registration reported a failure after the account already existed.
3. `fynxfunded.com` redirects to `www.fynxfunded.com`. The canonical www hostname is absent from Firebase Authentication's authorized domains. Email/password, Google and Apple providers are enabled.

## Changes

- Recognize the exact old/new rollout-error formats, still requiring fresh server reads and rejecting enrolled accounts.
- Make the server status action work for non-MFA accounts while rollout is paused, checking private and legacy factor state without migration writes. Existing factors remain locked during the rollout pause; enrollment stays disabled.
- Remove the security-preference write from signup. Repair missing public profile metadata at verified login. An email-delivery error explains that the identity already exists.
- Add explicit verification-email resend on login, consistent eight-character-plus-symbol signup guidance, duplicate-submission protection and confirmed-user navigation.
- Include a native patch for strict rollout-error handling and equivalent Funded email recovery. Native build validation is pending separately.
- Provide a narrowly scoped deployment script: only `fundedMfa` plus the `www.fynxfunded.com` OAuth hostname. It preserves other hostnames and does not activate MFA, payments, progression or trading.

## Validation

`npm run check:release` passed: 98 frontend tests, 143 function-policy tests, 16 callable integration checks with mocked database/Auth, lint, TypeScript and production build. Regression tests cover the literal `[400]` error, blocked legacy/private factors, disabled/revoked sessions, fresh server reads, signup verification failure and unverified-email recovery. Real Google/Apple browser approval and real inbox delivery remain user acceptance checks.

The attached FYNX Trade brief requests approval before deployment. This fix is prepared separately from the development-only terminal so it can be reviewed and released independently. Deployment needs the website build, the single callable update and canonical-domain addition; no production financial records are changed.
