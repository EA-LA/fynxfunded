# FYNX Funded website — October 11, 2026

Scope: website and supporting services, not iOS completion. Previously confirmed launch/rollback owner: Elham Amini. Purchases and automatic progression remain paused.

## 1. Broker specifications and public rules — partial

- [x] Preserve the versioned numerical schedule and existing purchased agreements.
- [x] Remove unconfirmed news-trading, EA, copying, strategy and VPN permissions from public rules. Remove the dashboard's fabricated account number and distinguish provisioned credentials from a live connection.
- [ ] Choose the production broker/platform/server and obtain explicit permission for the intended evaluation/funded program.
- [ ] Obtain a dated instrument catalog covering contracts, precision, leverage, costs, sessions, timezone/reset behavior and holding restrictions; approve the resulting wording.

## 2. History, equity integration and seven-day testing — partial

- [x] Connect the account workspace to the deployed authenticated `fundedAccountInsights` service for current and archived phase history.
- [x] Display independent broker balance/equity marks, broker timestamps, recorded floor distances and breaches. Stale records stay historical; missing/invalid history stays unavailable.
- [x] Separate account histories, preserve zero balances, exclude open/ambiguous trades, prefer net results and include charges only when their basis is known. Ignore late responses from a previous customer.
- [x] Label reconstructed performance as cumulative closed-trade P/L rather than broker balance/equity.
- [ ] Supply real account histories, independent equity, charges and daily-reset coverage; reconcile with broker statements.
- [ ] Complete seven actual elapsed days across the previously specified minimum five complete accounts and 100 distinct accepted events, with no unexplained discrepancies. No trial start or completion is fabricated.

The fresh production inventory found five challenges and zero broker accounts, trades, rule events or issued contracts. Synthetic QA fixtures do not count as broker history.

## 3. Progression, transitions and rollback — partial

- [x] Preserve manual pass/fund and automatic-progression holds.
- [x] Close the legacy evaluator path that could mark an account passed from closed trades without its original agreement and complete equity history.
- [x] Preserve existing challenge status, breaches, broker bindings and payment timestamps during webhook retries.
- [ ] Implement/rehearse the selected broker's transactional new-phase provisioning and binding. Seal prior agreement/evaluation/events before transition.
- [ ] Obtain owner approval of the exact progression and rollback procedures after the real pilot. An evaluation result is not transition approval.

## 4. Stripe, checkout and recovery — partial

- [x] Reconcile checkout source with the live purchase hold. Require verified authentication, launch approval, approved legal acceptance, current purchased rules and a live server key before production checkout can open.
- [x] Reserve stable checkout requests, reuse Stripe idempotency keys and recover the same session without downgrading paid orders.
- [x] Validate ownership, amount and purchase evidence at fulfillment; reject test-mode production entitlements; prevent duplicate events/email retries from resetting challenges.
- [x] Distinguish paid-but-processing from completed orders, add return-page retry/Billing recovery, remove unrelated local-order fallback and restrict receipts to paid owned orders.
- [x] Clarify current billing: one-time challenge fees with no automatic renewal.
- [x] Audit deployed Stripe configuration: test key, test webhook, `chargesEnabled=false`, `payoutsEnabled=false`, `detailsSubmitted=false`.
- [ ] Finish Stripe business onboarding and configure matching approved live server credentials/webhook through Secret Manager, never chat or browser variables.
- [ ] Complete real hosted sandbox payment, cancellation, decline and recovery journeys and provider-log verification; separately authorize the amount and refund procedure for a live payment test.
- [ ] If Premium/coaching subscriptions belong in launch, approve their pricing/renewal/cancellation/consent specification and implement that separate recurring product. PayPal and crypto are not activated.

## 5. Legal identity, policies and acceptance — partial

- [x] Add server-enforced acceptance evidence containing all four exact document texts, versions, SHA-256 hashes, operator details, billing model, approval reference and acceptance time. Draft, future-effective, incomplete, stale or changed documents cannot open checkout.
- [x] Explain that new-purchase terms/billing policies remain under review while purchases are paused. Existing purchases retain their accepted terms.
- [ ] Confirm contracting entity, jurisdiction, public contact/address, eligibility, refund/tax policy and retention with qualified counsel. Previously supplied FYNX LLC details are not independent legal review.
- [ ] Publish the exact approved versions, verify public text against stored hashes and complete/test the customer consent presentation before removing the purchase hold. No legal approval or customer acceptance is fabricated.

## 6. Export, retention, deletion and restoration — partial

- [x] Verify actual browser export and production ownership restrictions with disposable QA accounts.
- [x] Preserve newer export coverage for archived phases, private Funded inbox and push preferences while excluding push tokens; include web checkout acceptance attempts.
- [x] Add an operator-only exact-plan deletion executor requiring a reviewed policy reference, exact approval hash, record versions/ownership and an independent durable ledger. Reject open records, holds, shared identities and unreviewed nested records.
- [x] Add a guard for isolated restoration databases that blocks missing/incomplete/altered deletion ledgers.
- [x] Pass a real Firestore-emulator rehearsal with a separate restored database and independent local ledger. Deleted data was suppressed; retained billing and shared identity survived.
- [ ] Approve record-specific retention periods/exceptions and a complete inventory; configure a private versioned independent ledger bucket and verify access/reconciliation.
- [ ] Restore an actual approved cloud backup into an isolated database, apply the current ledger, verify rules/triggers/records and sign off recovery. The local rehearsal is not a production restore drill.

## 7. Desktop/mobile customer and beta journeys — partial

- [x] Exercise website password authentication with disposable pre-verified QA accounts, Billing isolation, export, deletion request, logout and protected routes.
- [x] Fix Billing/Trades/Settings page overflow and verify those routes at 320px, 390px and 1440px.
- [x] Add regression coverage for stale responses after session changes, failed-order receipts, KYC return states, absent/stale equity and phase selection.
- [x] Support stored country codes and remove the unscoped local-storage country preference. Correct misleading sign-in-history wording: removing a saved record does not revoke another device's token.
- [ ] Test real email verification/reset, Google/Apple login, MFA enrollment/recovery, token/session expiry, offline recovery, KYC capture and real broker/payment records on desktop and physical mobile browsers.
- [ ] Coordinate the separately prepared MFA-compatible website/backend/rules release before activation. The old client flow is not evidence of server-enforced MFA.
- [ ] Complete external beta with consenting testers and documented results. Automated/owner checks do not count as external beta.

## 8. Monitoring, backups and ownership — partial

- [x] Verify current inventory: PITR enabled; daily retention 28 days; weekly retention 84 days; 23 READY backups including October 11; ten enabled alert policies and an enabled email channel.
- [x] Record that shared-database delete protection is disabled; this website release does not alter shared database settings.
- [ ] Confirm alert receipt, incident escalation/support ownership and actual recovery. Enabled configuration is not delivery evidence.
- [ ] Review Funded-specific coverage for webhook failures, reconciliation gaps and stale broker data; configure approved missing coverage.

## 9. Deployment, CI and final launch — in progress

- [x] Isolate the website release; preserve purchases/progression holds and avoid activating MFA or replacing shared Firestore rules.
- [ ] Deploy this release and selected supporting functions; record exact commits/deployments and verify remote CI and production behavior.
- [ ] Approve commercial launch only after all outstanding broker, payment, legal, data, beta and operational gates pass.

## What we do together next

1. **Broker:** choose the provider/platform and obtain program permission plus API/instrument specifications; then configure credentials and test accounts.
2. **Business/legal:** confirm identity/contact and launch countries, obtain review of the four documents and retention decisions, then publish and test consent.
3. **Stripe:** finish business onboarding, configure separate matching test/live keys and webhooks, complete the sandbox journey and approve a specific live test amount/refund.
4. **Pilot:** import/reconcile actual history and run seven elapsed days. The clock starts only after feed and coverage are valid.
5. **People/recovery:** assign beta testers and incident/backup owners; prove alert delivery and cloud-backup restoration.
6. **Launch:** review the evidence and approve progression/payment activation with rollback ready.

## Evidence and reproduction

Reports beside this file: `operations.json`, `payments-configuration.json`, `retention-rehearsal.json`, `browser-layout.json`, `live-web-services.json`, `backend-deployment.json`. Read timestamps and `complete`/`deployed` flags; preparation is not deployment.

Run `npm run check:release`. Retention validation: `node scripts/apply-funded-retention.cjs --plan /absolute/reviewed-plan.json`. Execution additionally requires `--execute --approved-hash <exact-reviewed-hash> --ledger-bucket <private-independent-bucket>`; this release runs no production deletion. Emulator rehearsal requires Java and refuses nonlocal emulator endpoints.

Implementation references: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment) and [webhook signatures/retries](https://docs.stripe.com/webhooks). A success-page redirect alone is insufficient payment evidence.
