# FYNX Funded authentication repair

Deployed October 17, 2026 after explicit owner approval.

## Confirmed causes

1. Firebase 13 callable errors append the HTTP status, producing the exact screenshot text `Server verification is awaiting activation. [400]`. The compatibility handler compared the message to the older string without the suffix, so verified non-MFA users could not finish login.
2. Signup created the Firebase identity and sent verification, then attempted to create a security-settings document without `twoFactorEnabled`. The currently deployed Firestore rules require that field, so registration reported a failure after the account already existed.
3. `fynxfunded.com` redirects to `www.fynxfunded.com`. The canonical www hostname was absent from Firebase Authentication's authorized domains. Email/password, Google and Apple providers are enabled.

## Changes

- Recognize the exact old/new rollout-error formats, still requiring fresh server reads and rejecting enrolled accounts.
- Make the server status action work for non-MFA accounts while rollout is paused, checking private and legacy factor state without migration writes. Existing factors remain locked during the rollout pause; enrollment stays disabled.
- Remove the security-preference write from signup. Repair missing public profile metadata at verified login. An email-delivery error explains that the identity already exists.
- Add explicit verification-email resend on login, consistent eight-character-plus-symbol signup guidance, duplicate-submission protection and confirmed-user navigation.
- Include a native patch for strict rollout-error handling and equivalent Funded email recovery. The native Debug simulator build passed; native changes have not been uploaded to TestFlight.
- Provide a narrowly scoped deployment script: only `fundedMfa` plus the `www.fynxfunded.com` OAuth hostname. It preserves other hostnames and does not activate MFA, payments, progression or trading.

## Validation

`npm run check:release` passed: 98 frontend tests, 143 function-policy tests, 16 callable integration checks with mocked database/Auth, lint, TypeScript and production build. Regression tests cover the literal `[400]` error, blocked legacy/private factors, disabled/revoked sessions, fresh server reads, signup verification failure and unverified-email recovery. Real Google/Apple browser approval and real inbox delivery remain user acceptance checks.

## Deployment evidence

The owner approved “Deploy the login/signup fix.” [PR #22](https://github.com/EA-LA/fynxfunded/pull/22) merged as `dd71da6a390c1eb1b6ce69599e5fc4b9f8696c96`. The isolated deployment script successfully updated only `fundedMfa` and appended `www.fynxfunded.com` to Firebase authorized domains. Readback confirmed the hostname and ACTIVE function revision `fundedmfa-00004-ren`.

[Vercel deployment](https://vercel.com/elhams-projects-9aed9c12/fynxfunded/5kKNyiiAkWtfoGMTmevAJSAnDfMb) succeeded. Live assets include the new signup guidance and verification-resend control. GitHub quality and operations checks passed (run 39095368861).

MFA enrollment remains paused. Accounts with an existing factor remain protected and require support while rollout is paused. No production financial records were changed. Real owner login, Google/Apple OAuth approval and email inbox delivery still require user acceptance; enabled provider configuration is not proof of a completed OAuth login.

FYNX Trade is separate and remains development-only.
