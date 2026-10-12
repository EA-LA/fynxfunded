# Funded iOS completion — October 12, 2026

This update completes more implementation, selected production deployment, and reproducible tests. Commercial launch is still held. Payments, automatic progression, global MFA activation, and background push sending remain off. This document supersedes the October 11 status where explicitly updated below.

## Delivered

| Area | Completed in this update | Still required |
| --- | --- | --- |
| Broker phases | Operator-reviewed, transactional evaluation-to-evaluation transition; exact purchase/account binding; create-only phase archive with digest verification; concurrent/retry and tampering rehearsals | Approved integration/instruments, real accounts and reset coverage, independent reconciliation, seven elapsed days of proof, production operational review |
| MFA | Combined current website changes; real runtime token signing repaired and verified; enrollment, migration, replay, recovery, expiry, lockout and logout tested against Firebase | Coordinated website/remaining callable/rules deployment, native/web entry-point QA, approved recovery owner and global activation |
| Payments/Identity | Native PaymentIntent fulfillment, strict amount/ownership/agreement checks, idempotent transaction; signed webhook tests; existing Stripe sandbox endpoint subscribed to missing events; provider modes/account matched | Approved live provider configuration, publishable key, signed-device purchase/Identity journey; Premium/coaching billing specification |
| Content | Native checkout displays and explicitly accepts exact versioned legal documents supplied by the approved server release | Actual issued contracts, payout schedules, approved terms/coaching/partners, licensed calendar feed and history |
| QA | 17 live service checks; 17 live MFA checks; disposable identities cleaned; build 2 installed and launched on connected iPhone | Full customer web/native parity, OAuth, biometrics, offline/interruptions, APNs receipt/deep links, independent beta and native-speaker review |
| Legal/operations | Exact native acceptance recorded; record-specific retention scope expanded; partial completion represented honestly; local deletion/restore and held-record rehearsal | Legal/business/refund/tax approval, actual per-record decisions and holds, durable external production ledger, cloud restoration and incident/support delivery checks |
| Apple | Developer account recognized in Xcode; new Apple Distribution certificate available; next candidate build number 3 prepared | See native release status for the final archive/export/validation outcome; TestFlight, privacy/export-compliance and final review are separate gates |

## Changes and deployment

The branch incorporates `origin/main` through `16d950921d1471c8e7e27a613b92d26bce421c56`, preserving current website pricing, payment holds, legal acceptance, retention and layout work. Existing MFA token-change handling and account-switch protections remain intact.

Nine selected exports were deployed to `fynx-c7a28`: `fundedMfa`, `fundedMobileCheckout`, `stripeWebhook`, `fundedAccountInsights`, `fundedNotifications`, `fundedAccountUpdated`, `fundedChallengeUpdated`, `fundedPayoutUpdated`, and `fundedPrivacy`. Subsequent MFA and insights-only deployments are recorded separately. `deployment.json`, `mfa-deployment.json`, and `insights-deployment.json` record the exact source hashes bundled at each deployment. A hash in a deployment manifest does not mean every module/export was deployed. The website and staged rules were not deployed. The phase/retention operator libraries are local tools, not newly exposed customer callables.

The production audit found zero broker accounts, zero rule events, zero contracts and zero funded memberships, with five existing challenges. No approved legal release or progression approval exists. Stripe payment and Identity keys address the same **test** account; charges, payouts and completed onboarding are not enabled. The native publishable key is unconfigured. `test-webhook-configuration.json` records the later sandbox subscription repair; it supersedes that portion of `readiness.json`. No live payment, Identity verification, real customer deletion, broker transition, or customer push was performed.

## Native payment agreement and fulfillment

The native catalog withholds checkout until a valid approved/effective legal release is available. iOS shows the exact four document bodies and sends explicit acceptance with the release version and content hashes. The server compares these to the release and snapshots acceptance and purchased rules in the reserved checkout attempt/order. A retry cannot substitute another agreement.

The signed `payment_intent.succeeded` handler retrieves the current intent from Stripe, checks the native attempt reference, amount received, USD currency, customer/challenge parameters and original agreement, and creates the paid order/challenge in one transaction. It handles the webhook arriving before the pending order write. Duplicate delivery preserves later phase, breach, broker and refund state. Test-mode events are ignored by the production fulfillment handler. Existing hosted checkout behavior is preserved. No broker account is provisioned and no funding/payout approval is granted by fulfillment.

The existing Stripe **test** webhook now listens for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `payment_intent.succeeded`. This is provider subscription verification plus local signature/fulfillment testing, not proof of a complete signed-device payment journey.

## MFA signing, rollout and recovery

The runtime account `1011050657868-compute@developer.gserviceaccount.com` now has `roles/iam.serviceAccountTokenCreator` on **itself only**. No project-wide signing role was granted. IAM Credentials API was already enabled. After propagation, a real runtime custom token was issued, exchanged through Firebase Auth and accepted by a protected callable. See `mfa-signing-repair.json` and `mfa-canary.json`; the earlier failed canary is retained as historical evidence.

The live canary uses only a temporary cohort of at most ten strictly named disposable QA identities, with expiry no more than one hour away. Global readiness stays false. It tests actual first-factor sign-in, setup/wrong enrollment code, signed proof exchange, protected endpoint denial/acceptance, replay, concurrent one-use recovery, logout, expiry, private legacy migration, migrated recovery and persisted lockout. Cleanup removes QA identities, factors, sessions and the temporary cohort. Web/native logout makes a bounded best-effort server proof revocation before local sign-out; offline logout still clears local authentication and existing proof remains subject to server expiry.

Before global activation:

1. Review/merge this branch. Re-fetch live Firestore rules and preserve intervening changes when applying `firestore.mfa.rules`. Stage matching website, remaining `nativeCustomer`-protected exports and rules together; keep readiness false.
2. Choose the named support/recovery owner and window. Run signed-iOS and website tests for a dedicated non-MFA customer and a migrated MFA customer, including OAuth continuation, setup, recovery, expiry, account switching and logout. Re-run the canary after any signing changes.
3. Activate only after those results and the recovery plan are approved. Monitor protected-callable errors and customer support. If unsuccessful, turn readiness off to stop new enrollment/proof issuance; retain private factors, protected endpoint gates and client-deny rules. Protected customers must fail closed until server access is repaired or identity-verified recovery is performed by the approved owner. Never restore client-readable factors or client-side verification.
4. If retiring this signer, remove only the added self-member from this service account's Token Creator binding, preserving all other members/bindings. Do not remove it during an active rollout without a working replacement.

## Reviewed phase transition and archive

`fundedPhaseTransition.ts` supports only the next purchased **evaluation** phase in a two/three-phase program. It requires complete eligible flat history, no recorded breach, the original paid purchase/rules and a distinct verified next broker account with actual activation time. It re-reads all evidence in the committing Firestore transaction and rejects any change after plan review.

Execution additionally requires a reviewed exact plan hash/operator identity and `funded_release/current` approval linked to the same integration, with sealed/reconciled evidence reference/hash spanning at least seven elapsed days. No approval record or elapsed proof was manufactured. The source phase is created once with all events and an integrity digest; current events are removed and the challenge advances atomically. The next policy starts with **no** fabricated coverage and `awaiting_history`. Historical insight reads recompute the archive digest and withhold altered evidence.

The bounded atomic path accepts 1–200 events (at most 403 writes). Larger histories are rejected pending a separately reviewed staged archive workflow. Final evaluation-to-funded transitions are deliberately unsupported until a separate approved funding/provisioning workflow exists. The proposed rules deny archive/transition writes even by client admins; those rules are **not deployed**. Firestore/Admin SDK operators retain privileged write power, so this is create-only application behavior with integrity checking, not an external WORM storage guarantee.

Read-only preview, after obtaining normal operator ADC:

```sh
npm --prefix functions run build
node scripts/review-phase-transition.cjs --challenge CHALLENGE_ID --next-account ACCOUNT_RECORD_ID --plan /absolute/private/transition.json
```

Only after exact evidence/operator review, execute with `--execute --plan /absolute/private/transition.json --approved-hash EXACT_HASH --reviewed-by OPERATOR_ID`. The server release gate must also pass. There is no automatic or client-triggered transition.

## Retention and restoration

Reviewed exact-record plans now cover native checkout attempts, notification device registrations, owned inbox records, broker events/evaluations/audits and nested owned phase archives/events. The executor rechecks ownership, record update time, policy hash and holds. Unresolved payments and active financial states are held. No unrelated shared user/Tools/API identity is recursively deleted.

A bounded plan completion is recorded as `partially_completed` with `remainingScopeReviewRequired: true`; it does not claim the whole customer deletion request is complete. A follow-up exact plan remains possible. The emulator rehearsal deletes approved synthetic records, preserves a held billing record and shared profile, records a deletion ledger, and suppresses deleted records in an isolated restore. Production execution still requires actual reviewed policy references, the external private/versioned ledger bucket and a full cloud restoration rehearsal. No production deletion was executed.

## Reproducible verification

- Full release pipeline: lint, 81 frontend tests, frontend/backend TypeScript, 15 mocked MFA checks and production website build passed. Final backend suite: **122 tests in 13 files passed** (`final-functions-tests.log`, local ignored log).
- Proposed rules: **16 passed** through the actual Firebase Rules Test API (`mfa-rules-tests.json`). This does not deploy rules.
- Deployed service smoke: **17 passed**, cleanup complete (`live-smoke.json`). Deployed MFA canary: **17 passed**, cleanup complete (`mfa-canary.json`). These are synthetic QA identities, not real broker proof.
- Real local Firestore emulator operations: retention **6 passed**, phase transition **8 passed**, synthetic cleanup complete (`retention-rehearsal.json`, `phase-rehearsal.json`). CI runs both through the `operations` job.
- Stripe signature tests exercise genuine SDK signatures, altered/missing/expired signatures, fresh intent retrieval, test-mode ignore and retryable provider failure. Six signature tests and 16 native fulfillment tests are included in the 122.
- Native October 11 evidence (34 standalone model checks, four hosted unit tests and three UI cases) is retained; it is not described as rerun on the new candidate. Native changes today add exact legal consent, bounded server logout and three localized strings in 20 catalogs. Draft translations still require native-speaker review.

Run local operations with Java 21 available:

```sh
npm --prefix functions run build
npx --yes firebase-tools@15.8.0 emulators:exec --config scripts/firebase-retention-emulator.json --only firestore --project demo-funded-retention "node scripts/rehearse-ios-operations.cjs"
```

Live scripts are explicitly opt-in: `smoke-ios-completion.cjs --run-production` and `smoke-mfa-canary.cjs --run-production`. Do not treat synthetic checks as commercial approval. Credentials are held in memory/temporary private files and omitted from evidence.

Native release evidence and candidate paths: `/Users/h/Documents/FYNX/FUNDED_RELEASE_STATUS.md` and `/Users/h/.codex/workspaces/default/fynx-funded-ios-20261011/evidence`. Task-only native patches preserve the preexisting dirty checkout.
