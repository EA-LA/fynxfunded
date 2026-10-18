# FYNX Trade — first development delivery

October 17, 2026. **Development only; not approved for customer trading or production deployment.**

## Live authentication repair

[Authentication PR #22](https://github.com/EA-LA/fynxfunded/pull/22) is merged and deployed with the owner's explicit approval. The website now handles the paused-MFA response correctly, signup no longer reports failure after creating the identity, verification email can be resent, and `www.fynxfunded.com` is authorized for Firebase login. See [deployment evidence](../auth-repair-2026-10-17/REVIEW.md). Existing MFA factors remain protected. Real owner login, Google/Apple approval and inbox delivery still need user acceptance.

## Audit and architecture

- Web/backend: existing `EA-LA/fynxfunded` React/Vite application, Firebase Auth, Firestore, callable Cloud Functions, Stripe checkout/webhooks, funded dashboard and operations screens.
- iOS: existing `EA-LA/FYNX-app` SwiftUI app with Firebase and funded account views. Its working checkout contains extensive unrelated, uncommitted work. This delivery preserves it and records only the new work separately for review.
- Production Firebase remains `fynx-c7a28`. This prototype uses **only `demo-fynx-trade` on loopback emulators**. Production customers and financial records were not copied or changed.
- The existing Firebase identity and `orders`, `challenges`, `accounts` collection relationships are reused in the isolated development environment. Web and iOS use one Firebase UID and one authoritative account. Production single sign-on and commercial purchase provisioning are future integration steps, not enabled by this prototype.
- Stripe/Identity business approval is recorded as completed based on the owner's confirmation. The previously inspected runtime still used test payment credentials. Business approval alone does not activate live keys, webhooks, Identity completion or payouts.

## Implemented

| Area | Web | iOS | Server |
| --- | --- | --- | --- |
| Authentication | Existing login/signup, verification/resend; dev login opens Trade | Native development login/signup/resend; same emulator identity | Verified email, active/revoked identity and shared MFA status required |
| Accounts | Account selector; create internal $25K demo | Same account selector and demo creation | Transactional, idempotent provisioning linked to UID/order/challenge |
| Markets and charts | Searchable EURUSD, XAUUSD, BTCUSD; 1m/5m/15m candles or line; light/dark | Same three symbols/timeframes, Swift Charts candles/line, system appearance | Deterministic synthetic adapter; USD instruments; 24/7 development session |
| Orders | Market, limit, stop, SL/TP; cancel pending; full/half close | Equivalent order controls | Bid/ask, one adverse tick, $3.50/lot/side, margin checks, stale/crossed/future quote rejection |
| Account metrics | Balance, equity, P&L, margin, free margin | Balance, equity, P&L, free margin | Decimal money arithmetic; atomic transactions; client financial inputs ignored |
| Evaluation | Progress, failure reason, history-only accounts, Phase 2 link | Equivalent progress and status | Fixed internal 8%/5% targets, 5% daily/10% total loss, one trading day, closed exposure required |
| Records | Positions, pending, history, local inbox | Positions, pending, history, local inbox | Server-only event writes, command receipts, concurrent retry protection |
| Notifications | Accurate local captured status | Accurate local captured status | Deduplicated account-ready, phase-two-ready, failed, funded-review outbox records; **no SMTP** |

Phase 1 completion creates Phase 2 atomically. Failed accounts liquidate, cancel pending orders and retain history. Phase 2 completion requires review and creates no payout or funded-stage account.

The web Trade Now entry exists only with the development flag. iOS opens the terminal only in a DEBUG simulator run with `-fynx-trade-dev`; it is not public app navigation. No live trading endpoint is exported from the production Functions entrypoint. Production web builds remove the development route and terminal code.

## Run locally

Requirements: Node 22, Java 21+, Firebase CLI, and dependencies in both the web and `functions` directories. This Mac already has Java 21 inside Android Studio; no extra Java installation was needed.

```sh
npm ci
npm ci --prefix functions
npm run dev:trade
```

On this Mac, if Java/Firebase are not on PATH:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
PATH='/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin:/Users/h/.npm-global/bin:'"$PATH" \
npm run dev:trade
```

Open <http://127.0.0.1:5189/trade>. Register an internal account, use the verification link printed by the Auth emulator, then sign in. Create a $25K demo. No real payment or email occurs. Stop cleanly with Ctrl-C to export local state into ignored `.trade-dev/state`; restarting restores it. Restart `dev:trade` after backend changes: its staging directory is a compiled snapshot, not a guaranteed live-reload workflow.

Ports: Auth 9099, Firestore 8089, Functions 5009, hub 4409, logs 4509, web 5189. All are loopback-bound. The launcher strips ADC/Firebase token environment variables and pins the demo project. Server checks reject other projects/hosts. iOS uses a separately named Firebase app with the same demo project; production session/profile background work is skipped for the dev root.

## Validation and evidence

- `npm run check:release`: lint, 98 frontend tests, 161 function-policy/engine tests, 16 mocked callable integration checks, TypeScript and production build passed. The five additional environment-boundary tests passed separately (166 function tests total).
- [Emulator acceptance report](acceptance.json): all 13 checks passed against real local Firebase Auth, Firestore rules, callable HTTP and transaction tests. Covers registration/verification, ownership, tampering, concurrency/idempotency, partial closes, progression and failure. The report is generated by `node scripts/trade-dev/acceptance.cjs` while the server is running.
- [GitHub Actions run 39098452495](https://github.com/EA-LA/fynxfunded/actions/runs/39098452495): all three jobs passed, including the new isolated trading acceptance job on a clean Node 22 / Java 21 runner.
- Browser walkthrough: signup, unverified-login rejection, resend, local verification, verified login, $25K provisioning and a EURUSD market trade. Desktop and 390px phone layouts were inspected. [Desktop image](web-terminal.png), [phone image](web-mobile.png), [light theme](web-light.png).
- Native Debug simulator build passed. A native Firebase SDK test is implemented to read the web-created account, open and close an additional native trade and read shared history. The simulator runner crashed/stalled before completing it, so shared native execution is **not yet verified**. The invalid local Firebase app-ID placeholder found during testing was corrected. This is not a full native UI acceptance test; see [delivery status](delivery-status.json).
- Native integration fixture: `trade-browser@example.invalid` / `LocalDemo!123` is disposable local emulator data only. For the native test, create/verify that account and open a 0.10-lot EURUSD position through the web first. The test skips when the emulator is absent. It never signs into production.
- The exact requested acceptance sequence is **not fully complete**: activation/progression email is captured locally, not delivered; full iOS visual acceptance and public distribution remain pending. Progression/failure tests use internal synthetic timestamps, not a customer-controllable clock.

## Remaining engineering work

1. Production Stripe webhook-to-FYNX provisioning, commercial challenge mapping, eligibility/Identity gating, activation and reconciliation with existing customer accounts. No production account migration is included.
2. Configurable approved rule versions, one-step and funded simulation stages, consistency/restricted trading rules, real session calendars, currency conversion, swaps/rollovers and corporate actions where applicable.
3. Licensed market adapters beyond the three synthetic instruments. Indices, futures, stocks and other metals/FX are not implemented or enabled.
4. Branded SMTP delivery, retry/backoff, delivery logging and remaining security/purchase/progression/payout notification types. Current local outbox is not an email service.
5. Trade-specific staff dashboard with roles, mandatory admin MFA, suspension, provisioning/mail retry tools, audit investigation and feed health. Existing funded admin screens are not a completed trading back office.
6. Production database/event design, retention, reconciliation, backup/restore drills, monitoring/alerts, load and abuse tests, independent security review, and efficient real-time transport. This prototype polls; it is not a scalability claim.
7. Native navigation and full UI parity/acceptance, TestFlight delivery, Apple policy review and App Store release. [Native draft PR #3](https://github.com/EA-LA/FYNX-app/pull/3) includes the development module and integration changes for the current local app; unrelated uncommitted app work must be reconciled before merging into its older tracked baseline.

Development limits: 20 accounts/user, 20 open positions/pending orders/account, bounded embedded history, 60 order commands/minute/user, worker processes at most 100 active accounts per scan. Pending orders do not reserve margin; insufficient-margin triggers are rejected. Audit writes are client-protected, not cryptographically immutable against infrastructure administrators. These choices need production redesign and documented commercial execution/risk policies.

## Owner inputs and approval still needed

- Choose launch markets/countries and approve commercial challenge rules, execution terms and provider contracts.
- Obtain commercial display/simulation rights and any exchange permissions. Provider pricing and the least-cost legally suitable option remain Phase F research; no free-feed permission is assumed.
- Supply live Stripe/webhook and mail-provider configuration through secure project secrets, plus required domain/DNS access. Do not paste secrets into chat. Confirm Identity settings and customer eligibility workflow.
- Complete legal/compliance and Apple requirements review before enabling real purchases or public trading features.
- Approve a concrete production release after the remaining acceptance/security/license work is complete. The authentication approval does not authorize FYNX Trade deployment.

## Costs

No new paid services or subscriptions were purchased for this development delivery: **$0 new purchases**. Synthetic data and local emulators were used. Existing hosting/cloud charges are not measured by this report. Future market-data licensing, email, production infrastructure, legal work and Apple distribution costs are unquoted and unapproved.

## Chart license

Web charts use TradingView Lightweight Charts 5.2.0 with visible attribution and link. See [official documentation](https://tradingview.github.io/lightweight-charts/docs), [third-party notice](THIRD_PARTY_NOTICES.txt) and [Apache 2.0 license](LIGHTWEIGHT_CHARTS_LICENSE.txt). Native charts use Apple Swift Charts. No proprietary trading-terminal code or assets were copied.

## Review handoff

[Web/backend draft PR #23](https://github.com/EA-LA/fynxfunded/pull/23) and [native draft PR #3](https://github.com/EA-LA/FYNX-app/pull/3) preserve the development work for review. They are not merged or approved for production. The workspace routing timeout interrupted tool access; it did not remove these saved commits. The local demo is available while `dev:trade` is running. Native SDK and visual acceptance must be completed before claiming web/iOS acceptance parity.
