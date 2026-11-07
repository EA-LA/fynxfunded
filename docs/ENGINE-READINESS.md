# FYNX trading engine: readiness and how to connect it

The FYNX Trade terminal (`/trade/access`) and the trading engine behind it are built and tested. What's missing is the "fuel": a licensed price feed, a server to host the engine, and the owner's approval to switch trading on. This page lists exactly what to plug in.

## What is built

| Part | Where | What it does |
| --- | --- | --- |
| Engine core | `src/engine/core.ts` | Validates orders (volume steps, price steps, stop/target on the right side, free margin, fresh quotes). Fills market orders at bid/ask and pending limit/stop orders on price. Values profit in dollars for every pair (converts JPY, GBP… through the quote book). Works out equity, margin, free margin and margin level. Closes at stop loss / take profit. Rolls the trading day at 22:00 UTC from the balance at the reset. Enforces the daily loss and static maximum loss limits by closing everything and locking the account. `targetReport` gives profit vs target, trading days, best trading day and the best-day (consistency) share, and a plain list of what is still missing; the profit target is reported once for review only when target, minimum days and the consistency rule (`consistencyPercent`, 40 on FYNX Funded) are all met with nothing open. Idempotent orders (`clientId`). All money uses `decimal.js`, rounded to cents. Pure functions: no clock, no I/O. |
| Types | `src/engine/types.ts` | Instruments, quotes, orders, positions, deals, rule sets, account state, events, `EngineError` codes. |
| Venue | `src/engine/venue.ts` | `LocalVenue` runs accounts: connects a `QuoteFeed`, loads/saves through an `AccountStore` with optimistic locking, serialises commands per account, ticks on every command, publishes engine events. `buildSpecs` turns the 45-pair catalogue into instrument specs from venue settings. `rulesFromPurchase` turns an account's stored purchase rules (`profit_target_percent`, `daily_loss_percent`, `max_loss_percent`, `min_trading_days`, `consistency_percent`) into an engine `RuleSet` for `rulesFor`, refusing malformed values. Every snapshot carries a `report` (the target report). `MemoryStore` and `StaticQuoteFeed` exist for tests only. |
| Gateways | `src/engine/gateway.ts` | What the terminal talks to: `DisconnectedGateway` (default; nothing is sent), `HttpGateway` (the HTTP contract below) and `LocalGatewayAdapter` (in-process venue). `createGateway` picks one from `VITE_FYNX_TRADE_API_URL`. |
| Terminal wiring | `src/trade-access/useEngine.ts`, `TradeAccess.tsx` | Engine status pill, live bid/ask on SELL/BUY, confirm-to-send order flow (stop/target in pips converted to prices), positions with close buttons and an editor per position (change or remove stop loss / take profit as prices with the dollar result at each level, stop to break-even, warning when a stop is beyond the room left before the loss limit, partial close), pending orders with cancel, "Progress on this account" card on the Account tab from the snapshot report, history of deals, account strip from engine metrics (equity, margin, margin level, room to the loss limit). |
| Tests | `src/test/trading-engine.test.ts`, `src/test/engine-target-report.test.ts`, `src/test/trade-terminal.test.tsx` | Fills, conversions, validation, idempotency, metrics, partial/full close, SL/TP, pending fills, loss-limit lock, daily reset, target report, venue end to end, HTTP contract, target report and 40% best-day rule, purchase rules, terminal place/close, SL/TP edit and partial close through the engine. |

FYNX Funded's official evaluation keeps running on the existing server rule engine (`functions/src/apiRuleEngine.ts`, `fundedPolicy.ts`). The trading engine uses the same rule numbers (daily loss from the 22:00 UTC balance, static maximum loss, profit target, minimum days), so a phase result can be cross-checked against it.

## What to plug in ("the gas")

1. **A licensed price feed** for the 45 forex pairs, with a contract that allows using its prices to fill simulated orders. Write a `QuoteFeed` adapter (one `subscribe(symbols, onQuote)` function) for the provider's streaming API. TradingView display widgets cannot be used for this.
2. **A host for the engine.** This is either the FYNX API or a Cloud Function / server that does three things:
   - creates a `LocalVenue` with `buildSpecs(FOREX_PAIRS, { leverage, commissionPerLotPerSide, maxLots })`;
   - stores accounts with an `AccountStore` (for example a Firestore collection, using the `sequence` field as the lock);
   - loads each account's purchased rules (`rulesFor`), e.g. `rulesFromPurchase(startingBalance, purchase.rules, { funded })` with `consistency_percent: "40"` for evaluation phases, matching `functions/src/fundedPolicy.ts`.
3. **Run the engine on a timer.** Call `venue.snapshot(accountId)` for open accounts on every quote batch, or at least every second. That timer step is what fills pending orders and hits stops when nobody is clicking.
4. **Venue settings to confirm:** leverage, commission per lot per side, maximum lots, maximum quote age, and trading hours per symbol.
5. **Expose the HTTP contract below**, with Firebase ID-token authentication. Each user may only reach their own accounts.
6. **Set `VITE_FYNX_TRADE_API_URL`** in Vercel (an `https://` address) and add that host to `connect-src` in the site's Content-Security-Policy (`vercel.json`). These are owner-controlled settings.
7. **Switch trading on per account:** `fundedTradeAccess` must return `tradingEnabled: true` for accounts that may trade. Until then the terminal never sends an order, even when connected.

## HTTP contract (`HttpGateway`)

All requests use `Authorization: Bearer <Firebase ID token>`. Every response is JSON. A successful action returns a **Snapshot**: `{ state: AccountState, metrics: AccountMetrics, quotes: { [symbol]: Quote }, report?: TargetReport }`. `report` is optional; when it is present the terminal shows the progress card (LocalVenue always includes it).

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/v1/status` | | `{ priceFeed: boolean, execution: boolean, message }` |
| GET | `/v1/accounts/{id}` | | Runs the timer step, returns the snapshot |
| POST | `/v1/accounts/{id}/orders` | `OrderRequest` | `Idempotency-Key` header = `clientId` |
| POST | `/v1/accounts/{id}/positions/{positionId}/close` | `{ lots? }` | Partial close when `lots` is given |
| PATCH | `/v1/accounts/{id}/positions/{positionId}` | `{ stopLoss?, takeProfit? }` | `null` removes a level |
| DELETE | `/v1/accounts/{id}/orders/{orderId}` | | Cancels a pending order |

Errors: HTTP 4xx/5xx with `{ "error": { "code": "no_margin", "message": "Not enough free margin…" } }`. The terminal shows the message as it is. Codes come from `EngineError` (`bad_rules`, `unknown_symbol`, `no_quote`, `stale_quote`, `bad_volume`, `bad_price`, `bad_stop`, `bad_target`, `no_margin`, `account_closed`, `no_position`, `no_order`, `conflict`).

## Still owner decisions

- Price-feed provider and contract.
- Spreads/markups, leverage, commission, swap/rollover policy (swap is not in the engine yet), weekend gap handling.
- Whether a passed phase stops trading automatically or waits for review (today: reported, waits for review).
- Account number + password sign-in by email (requested 2026-11-07): needs credential issuing in the backend and an approved release. Today customers sign in with their FYNX login.
