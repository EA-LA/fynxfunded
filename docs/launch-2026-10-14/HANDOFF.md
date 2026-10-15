# FYNX Funded website and iOS parity — October 14, 2026

This update follows the current source and deployed-service audits, not the older pasted assessment. Commercial purchases and automatic progression remain paused. No trading provider was selected, no customer was charged, and no provider account or payout was created.

## Already present before this update

The current source already included the website/dashboard, challenge and order records, payment integration with a purchase hold, versioned rule evaluation, legal-acceptance records, support/privacy workflows, controlled phase transitions and private MFA rollout preparation. Their existence did not prove a connected broker or commercial launch readiness. Those controls were preserved.

## Website and shared backend

- Replaced the anonymous/localStorage order-status page with authenticated, ownership-checked server status. Billing, checkout confirmation and account workspaces link to the same progress view. Payment confirmation, challenge recording and confirmed provider readiness are separate.
- Added payment pending/failed/refunded, setup pending/in progress/failed, ready, access unavailable and review states. Support links carry the order reference into the form. Removed stale-customer rendering on Accounts.
- Added an AES-256-GCM credential vault. Ciphertext is authenticated against the user, challenge and account; the random encryption key lives in Secret Manager and is bound to the reveal service. Web and native reads must authenticate and match the current account binding. No plaintext fallback. Reveal is ephemeral; web access hides on focus loss and after one minute.
- Account-ready mail contains a signed-in dashboard link, never a password. Payment confirmations explain the same access flow. Email delivery no longer changes a challenge's account binding. Delivery retries use a lease; an ambiguous provider response can still cause a duplicate notification, never a duplicate trading account.
- Added an operator-only transactional import bridge for an independently confirmed simulated provider account. This does not create a broker account or replace the missing provider API integration. It checks paid-order ownership, first-phase status, conflicting bindings, fresh provider confirmation and replay fingerprint, encrypts access and removes a legacy plaintext password atomically. Later phases and credential rotation require reviewed workflows.
- Added hourly internal-order reconciliation and a read-only operator reconciliation command. Findings include missing challenge/account setup, duplicate payment references and binding conflicts. External broker-balance/webhook-delivery reconciliation still needs the provider connection. The scheduled scan is capped at 2,000 orders and marks a partial scan incomplete; it does not repair records or change trading access.
- Clarified simulated evaluation/funded-stage trading on the homepage and Terms; removed unsupported assertions of an operational SAR-reporting program. These edits do not constitute legal approval or amend previously accepted agreements. Existing FYNX sharing graphics and minimum-age wording were already present.
- Extended export/retention inventory for access logs and encrypted credentials. Private ciphertext/key material is excluded from customer export. Production deletion/retention policy approval remains outstanding.

## Native iOS parity

The Funded screens in `/Users/h/Documents/FYNX` now use the same deployed order-status and protected-credential services as the website. Orders, checkout confirmation and account details link to the native tracking view. Payment received does not show account-ready access before confirmed provisioning. The view supports refresh and support with the order reference, and rejects stale-user responses.

Credential reveal retains the existing biometric/passcode check, timed hiding, cancellation and expiring clipboard. It now requests decrypted access through the authenticated backend instead of fetching a plaintext password from Firestore. Native parsing verifies user/challenge/account binding and simulated environment, and rejects unsafe platform URLs. New source strings use the existing localization helper; translation review is still needed.

The iPhone 17 Pro simulator build and four contract tests plus the native order-progress UI test passed. Pending and failed setup screenshots were inspected. The largest text-size test also scrolled to and verified the support button remains reachable. The initial UI fixture lacked its authentication environment object; that test-only issue was fixed before the passing run. Stable action identifiers also corrected an exact-label mismatch in the accessibility test. Test routes and synthetic content are DEBUG-only. No real customer credentials, biometric flow or provider trading session were exercised on a physical device. The shared working directory's existing unrelated changes were preserved. This is a source/simulator update; it has not been uploaded to TestFlight or the App Store.

## Release status

- Website PR [18](https://github.com/EA-LA/fynxfunded/pull/18) merged as `958024874a5052ed7baa33453b0b02cfeac735f8`; GitHub quality checks passed. Vercel production is **Ready** and serves the updated assets at [www.fynxfunded.com](https://www.fynxfunded.com). The public order-status route redirects signed-out users to login.
- All six selected Firebase functions are ACTIVE. The hourly internal reconciliation schedule is ENABLED. Thirteen live synthetic service checks passed, including encrypted reveal and refund denial; those identities and fixtures were removed.
- Website QA identities and private local login files were removed. Final inventory returned to 23 pre-existing orders and zero provider accounts; four paid test orders still require actual provider setup. This is not proof of commercial or broker readiness.
- Purchases and automatic progression remain paused pending the owner steps below. No real charge, customer email, payout or provider account was created by this task.

## Operator tools

Run from this repository with the approved local Google Application Default Credentials, never with keys in chat.

- `node scripts/reconcile-funded-orders.cjs`: read-only full internal inventory. It does not query the broker.
- `node scripts/funded-credential-key.cjs --create`: creates the key only if absent. Do not replace/rotate this secret without a separately reviewed re-encryption plan; existing ciphertext depends on it.
- `node scripts/provision-funded-account.cjs --apply`: accept JSON on stdin from a secure operator workflow. Required fields: `userId`, `challengeId`, `accountId`, `platform`, `server`, `login`, `password`, `providerReference`, `providerConfirmedAt`, `environment: "simulated"`, `reviewedBy`. Optional `tradingUrl` must be an HTTPS platform entry URL with no embedded credentials/query/fragment. Never place that JSON in Git or command arguments. Supply only independently verified provider records. This release has not used the tool on a real account.
- `node scripts/deploy-funded-parity.cjs --deploy`: selected shared functions only. `--mail-only` and `--reconcile-only` select their respective services. These commands do not activate purchases/MFA/progression or deploy shared Firestore rules.

## What still needs the owner

1. **Provider:** choose the actual platform/broker (the pasted Match-Trader recommendation is not a selection or contract), obtain written permission for this program/US users and a management API package, sandbox account and specifications. Configure secrets privately. This unlocks real account creation, sync, disable/close actions and provider reconciliation.
2. **Rules:** approve instruments, leverage, commission/swap treatment, independent equity, loss reset timezone/DST, EA/copy/VPN/news/weekend/inactivity/consistency rules and country eligibility. The current versioned numerical rules were preserved; no new reset timezone or country list was invented.
3. **Company/legal:** confirm exact registered contracting name/address/jurisdiction/contact and legitimate representative; obtain approved terms, disclosures, refunds, taxes, retention and payout-denial/appeal policy. Publish exact approved document versions and configure legal-acceptance records. Draft pages do not satisfy this gate.
4. **Stripe and Identity:** complete the actual business onboarding/processor approval, live payments and Identity setup, webhook and native publishable-key configuration. Finish sandbox customer journeys. A live charge requires a separately agreed amount/refund test; none was made here.
5. **Broker pilot and payouts:** supply independent real histories and run seven actual elapsed days of reconciliation; approve phase/final-funding transitions and rollback. Confirm contracts, profit splits/schedules and payout provider. Hard-breach disabling, real payout execution and final funding cannot operate before provider setup/review.
6. **Operations:** assign support/incident and backup owners, confirm alert delivery, conduct a real isolated cloud-backup restoration, approve record-level retention/holds and the independent deletion ledger. Automatic reconciliation logs are not proof someone receives or acts on alerts.
7. **Customer beta/security:** consenting external beta testers, real Apple/Google/email and payment/Identity journeys, MFA recovery/rollout approval, signed-device APNs/biometric checks and language review. Global MFA/push activation remains separate from compatible code.
8. **Apple:** App Store Connect upload/processing, privacy labels/export-compliance review and App Review remain owner release steps. A build is not an App Store publication.

## Evidence

Local verification passed 87 frontend tests, 138 backend tests, 15 mocked MFA checks and 10 Firestore emulator provisioning/reconciliation checks. GitHub quality checks passed before merging. Local website browser checks covered 320, 390 and 1440-pixel widths and support-reference navigation. Deployed-service checks are synthetic and separate from real broker acceptance.

`backend-deployment.json`, `mail-deployment.json`, `reconciliation-deployment.json`, `live-services.json`, `provisioning-rehearsal.json` and `reconciliation-before.json` record actual results and limitations. Check success/deployed flags. Synthetic tests are not real broker proof. `production-website.json`, `native-tests.json` and the native patch record release provenance and matching iOS work.

Implementation references: [Firebase secret parameters](https://firebase.google.com/docs/functions/config-env) and [Secret Manager](https://docs.cloud.google.com/secret-manager/docs/creating-and-accessing-secrets).
