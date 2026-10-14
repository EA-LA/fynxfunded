# Funded iOS completion — October 11, 2026

This update completes additional implementation and verification. It does **not** declare the commercial service ready to launch. Payments, broker progression, MFA activation and background push sending remain inactive.

## Implemented

- Authenticated `fundedAccountInsights` checks ownership, the purchased versioned policy, account/phase binding and complete broker evidence. It uses the canonical decimal rule evaluator. Independent broker balance/equity marks are displayed; closed P&L never stands in for equity. Evidence older than 60 seconds is labeled stale, including after a screen remains open. Missing or unreconciled history has no fabricated risk values.
- Current and sealed historical phases have separate reads. Archives are read only; this change does not implement automatic phase transitions or create historical evidence. The UI only shows payout amounts/dates supplied by the matching account or authoritative challenge schedule.
- Server-generated private account/challenge/payout inbox updates, persisted read state, device opt-in/registration/revocation, generic APNs payloads and Funded deep links. No financial details or trading credentials appear in previews. A global delivery switch remains off; no customer push was sent.
- Data export now includes owned notification records, registration metadata without the token, and owned sealed phase archives/events. Deletion request intake remains available; destructive deletion/retention execution is still pending.
- Native account joining honors explicit broker binding and no longer borrows old-phase balances. P&L prefers authoritative net amounts, applies expressly signed costs once, and withholds ambiguous cost semantics.
- The compatible website MFA flow now uses server verification and custom-token proofs, removes third-party QR secret transmission, preserves OAuth profile bootstrap and avoids writing protected legacy MFA fields. A server-only fallback allows non-MFA customers while rollout is pending; missing connectivity, protected accounts and unexpected errors fail closed. Additional legacy callables are prepared for the same MFA gate. Website/rules/gate changes have not been deployed.
- Added 37 native strings across 20 languages; syntactic/placeholder checks passed. Translations are machine-assisted drafts with selected financial terminology corrections. Native-speaker approval is outstanding.
- Added app/widget required-reason privacy manifests for the observed UserDefaults and file timestamp uses. These do not replace a complete App Store privacy-label/data-processing review.

## Broker data contract

`fundedAccountInsights({challengeId, phase})` returns a read model only, with `authorizesTrading: false` and `authorizesPayout: false`. Current evidence is read from `rule_events` by `challengeId`. `rulePolicy`, `rulePolicyVersion`, `phase`, `currentPhase`, `accountSize`, `currency` and `brokerAccountId` must match exactly. Required balance/equity, costs, event identity/order and coverage semantics remain those of `fundedPolicy.ts`; the new endpoint deliberately does not weaken them.

For a historical phase, `funded_phase_archives/{challengeId}/phases/{phase}` must be server-owned, `sealed: true`, and retain matching `userId`, `challengeId`, phase and policy fields. Its `events` subcollection holds the full phase evidence. The service caps evaluation at 5,000 events and charts the most recent 500 marks; larger histories are withheld for review. A production ingestion/archive process is still required.

## Notification operation

The three deployed triggers observe meaningful changes to owned account/challenge/payout records. A stable event digest deduplicates retries and the current source is checked before accepting an event. Newly created records and ordinary equity ticks do not generate alerts. Devices older than 30 days or belonging to disabled/revoked users are skipped. Invalid registrations are removed only if they still match the attempted registration.

`funded_notifications_config/current.enabled` must explicitly be true to send. At present it is absent/false. Inbox delivery works while push is off. Delivery is attempted at most once per notice; an accepted FCM message is not proof of device receipt. An ambiguous provider result is recorded as unconfirmed and not automatically replayed. Verify APNs credentials, signed-device opt-in, permission denial, logout/account switching, background receipt and deep linking with a dedicated test account before enabling broad delivery. Disabling the global switch stops new sends but does not erase inbox history.

## MFA activation package — not activated

`firestore.mfa.rules` is staged separately from the default Firebase rules path. The live rules fetched October 11 matched the baseline from which this patch was prepared. Re-fetch/diff immediately before rollout; preserve any intervening production changes.

1. Review and merge the website auth/settings changes, the protected callable gates and the prepared rules. Keep `funded_mfa_rollout/current.ready` false during preparation. The existing deployed `fundedMfa` callable remains inactive.
2. In a controlled staging rollout, verify the runtime service account can sign custom tokens, private factor/session collections are client-denied, and protected customer callables use `nativeCustomer`/`requireFundedMfa`. Deploy compatible website code, backend gates and rules together with a concrete recovery owner.
3. Test a dedicated non-MFA customer and existing-MFA migration across website and signed iOS: setup, wrong/replayed code, throttling, recovery-code one-use, expiry, logout, account switch and OAuth continuation. The mocked callable checks and real Rules Test API checks below do not establish end-to-end activation.
4. Activate only after these checks and the rollout/recovery plan are approved. Rollback must preserve protected factors and fail closed; do not restore client-readable secrets or legacy client-side verification.

The prepared hosted checkout keeps the server-side payment pause. No billing or Identity configuration was changed.

## Verification evidence

- `deployment.json`: the six selected deployed exports and exact staged source hashes. Only account insights, notifications/three triggers and privacy export were deployed.
- `live-smoke.json`: 16 successful checks against the deployed service with a temporary synthetic customer, authentic Firebase email sign-in, real Firestore-triggered private inbox and complete cleanup. No real broker account, payment, email or push was used.
- `mfa-rules-tests.json`: all 14 cases passed the real Firebase Rules Test API. This tests proposed rules; it does not deploy them.
- `npm run test:mfa`: 13 mocked callable flows, including migration, TOTP/recovery replay, throttling and proof expiry. Included in release checks and CI.
- Web MFA tests cover rollout compatibility, protected flag handling, offline/unexpected failure, malformed/expired status, account switching and OAuth/signup bootstrap.
- Full local results and native screenshots/packages: `/Users/h/.codex/workspaces/default/fynx-funded-ios-20261011/evidence` and `/Users/h/Documents/FYNX/FUNDED_RELEASE_STATUS.md`.

Synthetic proof is not real broker reconciliation, a seven-day observation run, provider approval, customer parity or commercial launch approval.
