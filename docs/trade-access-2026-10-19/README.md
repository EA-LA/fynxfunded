# FYNX Trade account access — 19 October 2026

Status: **web portal and seven account/email backend functions deployed on 19 October 2026**, following explicit owner approval. Production trading and challenge purchases remain paused. The earlier login/signup repair remains live. Native code is prepared separately and has not been distributed.

## What this release adds

- A production-capable, view-only FYNX Trade portal at `/trade` and `/trade/access`, using the existing Firebase customer identity. Guests return to their selected account after login, including the signup/login handoff. No second password or authentication token is embedded in email links.
- Trade Now links in website navigation and the customer dashboard. Accounts show balances, equity, phase and the exact rules accepted at checkout. An account without permission to trade never presents enabled order controls.
- Server-confirmed web and native Stripe fulfillment requests provisioning for **new** purchases when the release flag is enabled. A transaction creates one deterministic account, links the existing order/challenge/customer, writes an audit event, and queues one account-access email. Replays preserve balances, activation, closed status, challenge progression and refund records.
- All supported account sizes and 1/2/3-phase agreements use the existing purchased-rule snapshots. This is account access only: leverage and execution terms remain unset, and trading is disabled.
- Branded Mailgun email containing the account ID and authenticated link. Concurrent sends are leased; rejected requests receive bounded retries; provider acknowledgements are logged. Network timeouts or crashed sends enter `delivery_unknown` for reconciliation rather than an automatic duplicate. Provider acceptance is not represented as inbox delivery.
- A free official TradingView hosted chart for EUR/USD, gold, Bitcoin and Ether, with source branding, timeframe controls and a clear view-only label. Market/source availability and delay information remain with TradingView. The chart is opt-in and explains that connection details are sent to TradingView.
- Native purchased-account view using the same authenticated API, native account selection and account activation, recorded rule metrics, hosted market chart and disabled trading. Account navigation and status parsing are updated in the current local iOS application.
- Firestore can reorder nested map keys. A validated normalization wrapper now preserves the original agreement digest across storage round trips while rejecting altered rules, ownership, hashes and acceptance evidence. The generated canonical policy files were not changed.
- Isolated the search renderer's Vite cache so production builds do not overwrite the running development server's dependency cache.

## Verification

- 107 frontend tests; 172 backend/policy tests; 16 existing mocked MFA integration checks passed.
- 10 new real-local-Auth/Firestore/callable checks in `acceptance.json`: pending payments, web/native paid fulfillment, concurrent provisioning, same-identity login and activation, ownership, unverified identity rejection, forbidden execution and client mutations, mail concurrency, retry/unknown outcomes, refunded history and replay preservation.
- The existing 13 development engine acceptance checks passed again, including order execution, phase progression and a failed account.
- ESLint, frontend TypeScript, backend TypeScript and production website build passed. Deployment staging compiled with `deploy: false`.
- Browser verification: verified-email login returned to the purchased-account portal and activated the $25,000 account; the official EUR/USD chart displayed actual market quotes. Screenshots accompany this report.
- The current native app **Debug arm64 simulator build passed**. The initial generic multi-architecture build exceeded the bounded five-minute window while rebuilding dependencies; the focused arm64 build succeeded. Native device UI/end-to-end testing and TestFlight/App Store distribution are still outstanding. A successful compile does not establish those results.
- At the owner's explicit request, one clearly labeled preview email was sent to the supplied Gmail address. Mailgun reported `delivered`, recipient server SMTP code 250. `email-preview-delivery.json` records the redacted outcome. No charge, production account or financial record was created. Inbox vs spam placement was not checked.

## What is configured now

Read-only inspection on 19 October confirmed Mailgun's custom sending domain is active, with valid sending DNS. The deployed Stripe payment function still uses a **test-mode** key; `FYNX_FUNDED_PURCHASES_APPROVED` is false and `paymentsPaused()` remains true. The owner already confirmed Stripe/Identity business approval; no repeat approval is needed for that fact, but technical live-payment setup is still absent. No licensed execution-feed secret was found in the relevant Firebase secret inventory.

## Approved release and launch procedure

1. Web PR 23 was merged and deployed to the existing Vercel project. PR 24 corrected the production security policy to allow the official TradingView script and iframe; the chart was verified against those production headers. Native PR 3 remains a separate, unreleased app change.
2. `node scripts/deploy-trade-access.cjs` only prepares an isolated, compiled source package. `--deploy` releases the seven listed functions to `fynx-c7a28` and enables the access-provisioning feature for future server-validated purchases. It does not release the development execution engine, open payments, enable MFA enrollment or rewrite historical orders.
3. The live `/trade/access` route now sends signed-out visitors to login and preserves the selected account across signup/login links. The callable transport is publicly reachable while the handler requires a verified Firebase identity, valid session and account ownership. Its invoker setting is explicit so an interrupted initial deployment cannot leave later updates inaccessible.
4. Existing orders are not automatically migrated. Any backfill needs an explicit, reviewed mapping and authorization to change those records.
5. Configure verified live Stripe credentials/webhook and approved purchase terms, then separately approve reopening checkout. No test/live key substitutions or real charges were made in this task.
6. The Firestore triggers and five-minute email retry scheduler are deployed. A controlled, separately approved live-payment journey remains necessary before paid launch. Local checks invoke the same fulfillment/provisioning/queue functions; they do not prove a real Stripe charge or production purchase-trigger delivery.

## Remaining work

- Live Stripe secret/webhook setup and final purchase-launch approval. Secrets should be entered through the provider/Secret Manager, never chat or Git.
- Full native device acceptance and app distribution. The current local app contains earlier uncommitted Funded work not present in GitHub main. PR 3 carries the new view and an exact integration patch for the current app; the older repository baseline has not been certified as a complete release build.
- A licensed server-side market feed, approved execution/leverage terms, production execution/risk service, market hours, load/recovery verification and broader administrative controls before trading can open. The existing synthetic development engine remains isolated.
- Delivery dashboards, bounce/complaint webhooks, and an audited administrative retry UI are future operations work. For `delivery_unknown`, inspect Mailgun logs using the stored notification ID and reconcile before requeueing. Never blanket-reset mail jobs. `blocked`, `failed` or binding conflicts require review.
- Separate automatic phase-outcome/activation notifications are not part of this account-access release; existing progression notification code and the isolated development outbox remain unchanged.

## Free real-price option and costs

The [official TradingView hosted widgets](https://www.tradingview.com/widget/) are offered free with branding. Their [data FAQ](https://www.tradingview.com/widget-docs/faq/data/) describes real-time forex/crypto availability, stock delays and source restrictions. The [advanced chart documentation](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/) supplies the supported embed integration. Quotes stay within the hosted display; we do not scrape, export or reuse them for execution or account valuation. Individual symbols may become unavailable.

A future execution feed needs separate provider permission for this paid simulated-evaluation use. [Twelve Data business plans](https://twelvedata.com/pricing-business) are one provider to request a quote from; its [usage policy](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage) excludes third-party commercial display from individual plans. We have not purchased a plan or confirmed funded-simulation execution rights with any provider.

No new paid data subscription or service was purchased. One preview email used the existing Mailgun account; marginal email charges and existing infrastructure bills were not measured. Deployed scheduling/functions use the existing cloud billing plan.
