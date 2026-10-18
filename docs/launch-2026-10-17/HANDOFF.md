# FYNX Funded checklist — October 17, 2026

This follows the October 14 implementation and audits the current application. Payment acceptance, phase progression, MFA rollout and push activation remain paused. Provider integration and a complete commercial launch are still pending.

## Added in this update

- An owner-only **Operations health** tab reads the scheduled internal reconciliation report. It distinguishes missing, invalid, stale, incomplete and clear reports, shows launch holds and a bounded exception queue, and provides refresh/retry. It cannot repair records, create accounts, advance phases or execute payouts.
- Active-account totals now require confirmed account setup; a challenge record no longer counts as a connected trading account. Admin phase/funding controls reflect the existing backend hold. Old session results and selected customer details are cleared/hidden when the owner session changes.
- Website and iOS validate the order-status response before showing account readiness. A paid order cannot appear ready without its matching challenge/account binding. Invalid dates, conflicting payment states and malformed identifiers fail closed. Trading links and credentials remain scoped to the signed-in customer.
- Website status retries after connectivity returns. iOS refreshes when the app becomes active again. Customer order status and secure credential access use the same backend as the website. The owner operations console remains a website administration feature.
- Structured reconciliation error/attention logs and three Funded-specific Cloud Monitoring policies were added. These policies have **no notification recipients yet**; incident delivery has not been verified. A missing run becomes stale in the dashboard; these log policies do not themselves detect a completely absent run.
- Fixed the inherited Firebase Functions/Admin dependency peer conflict so clean function installs and release checks succeed. Audit utilities now support separate dated evidence files.

## Original checklist: current position

| Checklist area | Implemented | Remaining dependency |
| --- | --- | --- |
| Payment webhook | Signature checks, replay protection, recorded order/configuration and payment status | Connect approved live Stripe account and complete agreed payment/Identity journeys |
| Account provisioning | Pending/failed/ready UI; encrypted access; operator import of independently confirmed simulated accounts | Chosen provider, management API, sandbox and actual automatic account creation |
| Customer delivery | Confirmation and account-ready messages link to authenticated access; no passwords in email | Real provider confirmation and consenting end-to-end customer delivery test |
| Metrics and rules | Backend evaluation foundations and versioned rules; progression held | Provider balances/equity/trades, agreed rule semantics, disable-account and phase-transition integration |
| Payouts | Request/review foundations | Verified trading history, contracts, payout provider, eligibility/signoff and real payout verification |
| Reconciliation | Hourly internal order/account scan, owner dashboard and console incident policies | Broker comparison, seven actual days of evidence, alert recipient/receipt and incident ownership |
| Disclosures | Simulated environment stated; unsupported SAR-program claim removed; FYNX sharing image already present | Exact company details and approved legal/rule/country/refund/appeal documents |
| Backups | PITR and daily/weekly schedules exist; 29 READY backups observed | Isolated restore exercise, approved retention/deletion ledger and recovery owner |
| iOS parity | Same authenticated order/credential backend, strict readiness checks, foreground refresh | Current build/test evidence below; Apple release and physical-device checks remain separate |

## Stripe update supplied by owner

On October 17 the owner reported **Stripe/Identity approval completed**. This is recorded as completed business approval reported by the owner, not as an independently verified live integration.

The read-only deployed-service audit still found test-mode payment and Identity secrets, enabled test webhooks and no native publishable key. The account reachable with those existing test keys reported charges/payouts/details disabled. This may be an older sandbox; it does not disprove approval of another live account. The next step is securely configuring the approved account's live keys, matching webhooks and publishable key, then verifying the intended journeys. Do not put keys in chat or Git. No charge or payout was made.

## Owner actions still required

1. Supply the selected provider, signed service arrangement, management/sandbox API access and approved instruments/leverage. This unlocks account creation, trade sync, hard-breach disabling and phase progression.
2. Supply exact registered company details and reviewed terms/rules/countries, loss-reset time and DST treatment, refund/denial/appeal and retention policies. Publish the approved versions through the existing release/acceptance workflow.
3. Connect the approved live Stripe/Identity account securely. Complete consenting Identity verification and an explicitly agreed payment/refund test before public checkout.
4. Approve contracts and payout provider/workflow, then run the real broker pilot and seven elapsed days of reconciliation. There are currently no connected accounts, trades, issued contracts or funded memberships in the audited database.
5. Assign support/incident and backup owners; choose alert recipients, verify receipt, run isolated cloud restoration and approve the retention/deletion ledger. Console policies and backup files alone do not complete these checks.
6. Complete external customer beta, security/language review, real sign-in/payment/Identity journeys, MFA recovery/rollout and signed-device push/biometric tests.
7. Complete App Store Connect authentication/upload, processing, privacy/export declarations and App Review. A local build or archive is not an App Store release.

## Verification and provenance

- Full web release pipeline passed locally: lint, 94 frontend tests, 143 function tests, 15 mocked MFA integration checks, TypeScript and production build. The production build retains an existing large Firebase chunk warning.
- Owner panel checked in a real browser at desktop and 390-pixel width, including refresh and scrolling to findings. `operations-preview.png` is explicitly synthetic, with no customer data; no browser errors were recorded.
- Function dependency audit: zero high/critical findings; eight moderate transitive findings remain. The suggested broad fix includes an Admin SDK major upgrade and is not represented as completed.
- `readiness.json`, `operations-audit.json`, `monitoring.json` and the sanitized reconciliation snapshot record actual observed state. Historical audits are not overwritten.
- `native-changes.patch` records incremental changes relative to captured reference copies; it is not a replacement for the complete shared native project. `native-source-hashes.json` identifies the final files tested. Full copies of those four files are saved locally in `/Users/h/.codex/workspaces/default/fynx-funded-ios-20261017/source/`. The native checkout contains other ongoing work and was not reset or committed wholesale.
- Website PR [#20](https://github.com/EA-LA/fynxfunded/pull/20) merged as `6095dd2e359b7c517e64a57621e3e14d3272557d` after both GitHub jobs passed, including the Firestore operations rehearsal. Vercel deployment succeeded. Public assets at https://www.fynxfunded.com/ contain the new operations panel, holds, status validation and reconnect handling (`web-release.json`).
- Both selected backend functions are ACTIVE. A scheduled reconciliation run completed with 23 orders and four account-setup findings; its structured WARNING log was observed. Anonymous access to the operations callable returned PERMISSION_DENIED. Actual owner-session access was not impersonated; its authorization path was unit tested (`live-operations-check.json`).
- Native simulator build and **six checks passed** (five Funded access/status unit tests and one UI test with pending setup, failed setup and support at the largest text size), iPhone 17 Pro / iOS 26.5. The normal pending screen and large-type attachments were inspected. These are synthetic fixtures, not real provider/Stripe completion. `native-test-summary.json` and `native-tested-sources.json` record scope and unchanged source hashes.
- The initial package-cache read and subsequent iCloud-coordinated project read stalled; a local project wrapper using the same original source files and a local package cache resolved the build issue.
- Signed Release archive and App Store Connect-method IPA export **succeeded** for version **1.4 (4)**. Both the archive app and exported app passed deep/strict signature verification. All four tested source hashes remained unchanged. The IPA is `/Users/h/.codex/workspaces/default/fynx-funded-ios-20261017/export-build4/FYNX.ipa`; checksums and flags are in `native-release.json`.
- This is a local release candidate. It was not uploaded or installed on a physical phone; Apple processing/review and build-number availability were not verified. The encryption declaration is absent and requires the owner's review with the privacy/export submission. The shared project version was not edited; build 4 was supplied to the archive command.
- The saved native patch uses zero context; use `git apply --unidiff-zero` only after comparing the recorded source hashes.

Implementation reference: [Cloud Monitoring log-based alerts](https://docs.cloud.google.com/logging/docs/alerting/log-based-alerts?hl=en).
