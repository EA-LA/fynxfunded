# Autopilot backlog (fynxfunded)

Prioritized, page by page. One to three focused changes per run. Safety: no changes to Firestore rules, auth/MFA, payments/checkout, trade fills, balances or evaluation outcomes.

## Site-wide
- [x] Friendly 404 page with navigation, helpful links and correct title/noindex (2026-11-03)
- [x] Footer "Trade Now" spacing fix (2026-11-03)
- [ ] Footer "Discord" / "Twitter" are plain text, not links: link them once real URLs are confirmed (or hide)
- [x] Footer support email is now a clickable mailto link (2026-11-03)
- [x] Opening a shared link like /payouts#calendar or /faq#daily-loss directly now jumps to that section (was: stayed at the top of the page) (2026-11-04)
- [x] New pages open at the top and #section links jump to the section (was: footer links left you at the bottom of the next page) (2026-11-03)
- [x] Removed the long "FYNX Ecosystem" link list from the bottom of every page at the owner's request; the same destinations stay in the header ecosystem menu (and the dashboard Resources page) (2026-11-04)
- [x] Browser tabs on login, sign-up, certificate lookup, checkout and every dashboard page all said "Account"; each now has its own name (e.g. "Log in", "Analytics · Dashboard"), still hidden from search engines (2026-11-05)
- [ ] Performance: main bundle chunk is >500 kB; split heavy routes/libs further
- [x] "Skip to main content" link for keyboard and screen-reader users on every public page (2026-11-04)
- [ ] Accessibility pass (focus outlines, heading order)
- [ ] Translate 404, FAQ and calculator into the languages offered by the language selector

## Home (/)
- [x] Plan cards show phase 1 target, daily loss, max loss and minimum days in dollars, plus "See these rules in dollars" calculator links (2026-11-04)
- [x] "Know your numbers" section: links to calculator, program comparison and payout estimator, plus the live next payout window (2026-11-04)
- [ ] Hero: review copy and spacing on small phones

## Challenges (/challenges)
- [x] Side-by-side comparison of 1/2/3-phase programs for a chosen size, in dollars (2026-11-03)
- [x] Link each plan to the rules calculator preset for that size/program (2026-11-03)
- [x] Comparison switches (Quick/Full, 1/2/3-phase) announce the selected option to screen readers; table row labels are proper row headers (2026-11-06)
- [x] "Find your challenge" (/challenges#finder): fee budget, dollar risk per trade, losing trades per day the daily allowance should absorb, priority (lowest fee, best value, most room, fewest days, largest account, best split) and program filter; top 3 plans with reasons and cautions, full list, closest options and what to change when nothing fits, shareable link; linked from the Challenges intro, home plan cards and the FAQ which-program answer (2026-11-06)
- [ ] Let "Start challenge" preselect size/program in the builder (needs care: builder feeds checkout)
- [x] Finder: optional "Days a week you can trade" (1–5) shows the earliest calendar time the minimum trading days take ("5 weeks+") on each plan card, in the reasons and as an "Earliest finish" column in the full list; kept in the share link (fdays=3); clearly a floor, not a deadline (no time limit) (2026-11-06)

## How it works (/how-it-works)
- [x] Program/size picker showing every phase in dollars, plus "How a trading day works" (2026-11-03)
- [x] Chosen program/size is kept in the address (/how-it-works?size=50000&program=3-phase) so it can be shared (2026-11-04)
- [x] "Plan your risk per trade for this account" link to the risk planner for the chosen program/size (2026-11-04)

## Trading rules (/rules)
- [x] Rules calculator: targets/floors in dollars, today's loss floor, 40% consistency check (2026-11-03)
- [x] Let the calculator pick which phase you're in (2026-11-03)
- [x] Accept size/program/phase from the URL and keep the address shareable (2026-11-03)
- [x] Risk and pace planner (/rules#risk-planner): risk per trade in % or $, losing trades that fit before the daily and maximum-loss floors, winners needed for the target, break-even win rate, steady daily pace and the biggest day that fits the 40% rule (2026-11-04)
- [x] Risk planner linked from the home "Know your numbers" section, How it works and the dashboard Objectives page (opens on the trader's account size and slider risk) (2026-11-04)
- [x] "Copy a link to this plan": the planner's size/program/phase, risk, reward and days are saved in a shareable address (2026-11-04)
- [x] Trading-day clock (/rules#trading-day): UTC and local time, live countdown to the 22:00 UTC reset, 24-hour bar, journal session labels in local time, and "Check a time" to see which daily-loss period a moment counts against; linked from the hero and the FAQ reset answer (2026-11-04)
- [x] Trading-day clock: "Add the daily reset to my calendar" (.ics, one event repeating daily at 22:00 UTC, optional 15/30/60-minute reminder) (2026-11-05)
- [x] Position size calculator (/rules#position-size): lots from risk and stop distance for USD-quoted forex, USD-based forex (trader types the price), USD/JPY, gold and any other instrument (trader types the point value), with round-turn charges, rounded down to 0.01 lots, loss at the stop vs today's allowance, target distance and profit, minimum-lot warning and a shareable link; opened from the risk planner ("Turn this risk into a lot size"), the Rules intro and a new FAQ answer (/faq#lot-size) (2026-11-05)
- [x] Challenge pass simulator (/rules#simulator): plays a plan (risk, reward, win rate, trades per day, charges, day limit) forward 2,000 times against the daily loss, maximum loss, minimum days and 40% rules for one phase or all phases; pass rate, how runs ended, typical trading days to pass with a spread chart, average result per trade, "stop before a breach" switch, re-run and shareable link; opened from the risk planner ("Test this plan in the pass simulator"), the Rules intro and a new FAQ answer (/faq#pass-odds) (2026-11-05)
- [x] Simulator from the trader's own record: "Your record in the pass simulator" on dashboard Analytics and each account's Analysis tab turns closed trades (win rate, average win/loss, trades per trading day) into a plan, runs 2,000 simulations for a chosen size/program/phase, flags slow or floor-heavy results and opens the full simulator preloaded; needs 10+ wins/losses with at least one of each, reward is rounded down (never flatters), labelled as past results; FAQ pass-odds answer mentions it (2026-11-05)
- [x] Journal simulator: "One of your real trades" switch replays the trader's own wins and losses picked at random (resized to the chosen account), shows biggest win/loss, warns when the biggest loss alone breaks the daily limit, and compares the pass rate with the average method (2026-11-05)
- [x] Pass simulator on /rules: "One of my own trade results" method: paste results or open a CSV/text file (profit column picked from broker exports, $/commas/(80)/minus signs understood, up to 5,000 results, read on the device only), optional original account size to resize, summary (wins/losses, win rate, averages, biggest win/loss, net), skipped-text notice, biggest-loss vs daily allowance warning, made-up example button, shareable link opens this mode (/rules?smethod=own#simulator); linked from the Rules intro and the FAQ pass-odds answer (2026-11-05)
- [x] Replay your record day by day (/rules#replay): the trader's closed trades played back in their real order (no shuffling) against the schedule for a chosen size/program/phase or all phases in a row; broker CSV (profit + close-time columns found by name, MT5 "Time…Time" picks the close time), "date, result" lines, or undated lists replayed N per day; year-first dates, choice of the file's time zone (UTC, broker server UTC+2/+3 and others), trades grouped into 22:00 UTC trading days; verdict (passed on which day, which limit broke on which day and by how much, or what is still needed: profit, days, 40% rule), trading days/trades used, closest call to a floor, balance chart against target and floors, a row per trading day; optional resize and extra charges; made-up example; settings-only share link; read on the device only. Linked from the Rules intro, the simulator's own-results mode and the FAQ pass-odds answer (2026-11-06)
- [x] Dashboard: "Your journal, replayed day by day" on Analytics and each account's Analysis tab: the trader's own closed trades (net of recorded commission/swap) in closing order, grouped into 22:00 UTC trading days, against a chosen size/program/phase or all phases in a row; same verdict, figures, balance chart and day table as /rules#replay (now one shared view), optional resize to another size, follows the 7D/30D/All range, clearly not the official status, links to Objectives and to /rules#replay for broker exports (2026-11-06)
- [x] "What getting funded could cost" under the pass simulator results (all phases, or any one-phase program): published fee per attempt, pass chance among finished runs (runs still going at the trader's own day limit are left out, since there is no time limit), average attempts, attempts for a 90% chance, average fees paid, funded profit needed at the plan split to earn the fees back, chance of being funded within 1/2/3/5 attempts with the most fees that could cost, warning when no run passed or few passed; single-phase runs get a "Simulate all phases" button; new FAQ answer (/faq#funding-cost) and glossary term "Challenge fee" (2026-11-06)
- [x] Position size calculator: "Forex cross pair (no US dollar)" for pairs quoted in JPY, GBP, CAD, CHF, AUD or NZD (EUR/GBP, GBP/JPY, AUD/CAD…): pip size per quote currency, the trader types the matching US-dollar pair price (labelled, cleared when the currency changes), kept in the share link (inst=cross&qc=GBP); FAQ lot-size answer explains it (2026-11-07)
- [ ] Position size calculator: use verified broker contract specs when published
- [ ] Show the planner's daily pace against the trader's real progress on the dashboard (needs verified evaluation data)

## Payouts (/payouts)
- [x] Payout split estimator from approved profit-split table, clearly labelled estimate (2026-11-03)
- [x] Fix incomplete profit-split tiers: full size × program table from the catalog (2026-11-03)
- [x] Payout calendar: live "next request window" card based on today's date, linkable as /payouts#calendar (2026-11-03)
- [x] "Add both windows to my calendar" (.ics download for the next two request windows) (2026-11-04)
- [x] "Am I ready to request a payout?" self-check (/payouts#readiness): five published conditions answered by the trader (days since last payout, net profit vs $50 minimum at the plan split, violations, open positions, KYC), met/missing/unanswered per item with what to do, next request window; nothing saved or sent; linked from the eligibility list, FAQ payout-eligibility answer and dashboard Payouts (2026-11-06)
- [x] Payout estimator: "Compared with the challenge fee": how many times the estimated share covers the published fee for that size/program, or how far short it is, and the net profit that covers it; links to the simulator's funding-cost view (2026-11-06)
- [ ] Dashboard Payouts: prefill the readiness check from the trader's verified funded account once payout eligibility data is reliable
- [x] Fixed: dashboard Payouts said "Bi-weekly, every 14 calendar days"; now matches the published calendar (twice a month, 1st–3rd and 16th–18th UTC) (2026-11-06)
- [ ] Dashboard Payouts says profit split "Up to 90%" for everyone; show the trader's own plan split once account data is verified

## FAQ (/faq)
- [x] Search, FAQPage structured data, related links and "Email support" block (2026-11-03)
- [x] Questions grouped by topic with filter chips; 13 new answers (reset time, loss floors, consistency, targets, days, split, payout windows, verification) with figures pulled from the published schedule (2026-11-03)
- [x] Each question has its own shareable link (/faq#question-id) and a next-step link (2026-11-03)
- [x] Home FAQ preview: curated questions from the real FAQ, each linking to its answer (/faq#id) (2026-11-04)
- [x] Glossary (/faq#glossary): 36 trading and evaluation terms with search (names, other names and definitions), area filters, A–Z jump links, a shareable link per term (/faq#term-pip, highlighted when opened) and links to the matching calculator or answer; FYNX figures come from the published schedule (2026-11-05)
- [x] Glossary help on /rules: dotted words in the schedule table, a "Words used here" line on every rule card, and "?" buttons beside the labels of the rules calculator, risk planner, pass simulator, position size calculator and trading-day clock; tap/click/keyboard opens the plain definition with "Open in the glossary" and the term's next step (2026-11-05)
- [x] Glossary help on How it works ("Words used here" on every step and the trading-day box), Challenges (plan card labels and comparison rows) and Payouts (split, eligibility list, calendar) (2026-11-06)
- [x] Glossary help on dashboard Objectives (each objective title, consistency rule, planned-risk slider, "Words used here") and Analytics labels (win rate, drawdown, payoff ratio, below peak); Objectives links to the journal replay (2026-11-06)
- [x] Glossary help on the Trades page (Lots, Pips, Risk %, R:R, Session headers beside the sort buttons; Win rate and Volume tiles) and the account workspace (Account MetriX tiles and "General statistics": win rate, profit factor, average R:R, drawdown, average profit/loss, expectancy, best session); new glossary terms "Profit factor" and "Expectancy", also explained on dashboard Analytics (2026-11-06)
- [ ] Translate the glossary with the rest of the FAQ

## Legal pages (/terms, /privacy, /risk-disclosure, /refund-policy, /aml-kyc)
- [x] Table of contents with anchor links and "last updated" date (already present; verified 2026-11-03)
- [x] "Back to contents" link after each section (2026-11-04)

## Certificate verification (/certificates/verify)
- [x] Public lookup page: enter an ID or paste a verification link; IDs are tidied (spaces, lower case, full links) (2026-11-04)
- [x] Site header/footer, "Copy verification link", status-checked time, "Try again" when the lookup is unavailable, help when not found, "What a verified certificate tells you" (2026-11-04)
- [x] Linked from the footer and a new FAQ answer (/faq#certificate-verification) (2026-11-04)
- [ ] Add /certificates/verify to the search-engine page list (needs a static render route; check the Vercel rewrite first)
- [ ] Learning certificates: hide rows that don't apply (passed/funded date, profit split) instead of showing "—"

## FYNX Trade (/trade)
- [x] Own home page at /trade (own header/footer, hero, facts, platform, features, how it works, all 45 pairs, prop firm & broker partnership, FAQ); "Trade Now" on FYNX Funded goes there; terminal at /trade/access; FYNX Trade in the ecosystem menu (2026-11-07)
- [ ] Make /trade indexable by search engines (needs its own static page; vercel.json rewrites /trade to index.html, owner-controlled)
- [x] MT5-style terminal: Market Watch with 45 forex pairs (search, groups, favourites), live TradingView chart, price and ticker after one-time consent, order panel (SELL/BUY, market/limit/stop, lots stepper, SL/TP in pips, pip value, risk/profit in dollars, share of daily loss allowance), account bar, Positions/Pending/History/Account tabs, phone bottom menu (2026-11-07)
- [x] Trading engine (src/engine): order validation, bid/ask fills, pending orders, SL/TP, P/L in USD for all pairs, margin, daily reset, loss-limit lock, target report, idempotency; LocalVenue with QuoteFeed/AccountStore ports; Disconnected/HTTP/Local gateways; terminal wired (confirm order, positions/close, pending/cancel, history, metrics); docs/ENGINE-READINESS.md (2026-11-07)
- [ ] Connect the engine: licensed QuoteFeed adapter, host (FYNX API or Cloud Function) exposing the HTTP contract, Firestore AccountStore, timer step, VITE_FYNX_TRADE_API_URL + CSP connect-src, tradingEnabled per account (owner decisions)
- [x] Engine: consistency (40% best day) check in the target report: `targetReport` (profit vs target, trading days, best 22:00 UTC day and its share, total profit at which the best day fits, plain list of what's missing); the target is only reported when all rules are met; every venue snapshot carries the report; `rulesFromPurchase` turns stored purchase rules into an engine rule set (2026-11-07)
- [x] Engine: per-symbol trading hours (`src/engine/hours.ts`: forex week in New York time with daylight saving, next open/close, holiday/maintenance closures, `hoursBySymbol`), refusals while closed (cancel still allowed), weekend-gap fills and loss limits on the first price after the reopen, swap/rollover per symbol (USD per lot per night, triple Wednesday, none on weekend resets, settled on close); terminal: market-closed note with local opening time and countdown, Confirm hidden while closed, Swap column in Positions and History (2026-11-07)
- [x] Engine: market state per symbol in `/v1/status` (`venue.markets()`, host adds `markets`, `parseMarkets` in HttpGateway drops malformed entries; older servers without it still work); terminal refreshes status every minute and shows a lock + closure reason (e.g. holiday) next to closed pairs in Market Watch and a per-pair note in the order panel (2026-11-08)
- [x] Terminal: Position/Order editors explain "market closed" before saving (reason, local opening time, countdown); Save, Close part and the row Close button are locked while closed; cancelling a pending order still works (2026-11-08)
- [ ] Engine: enter the price provider's published holiday calendar as `closures` once the provider is chosen (owner/provider data)
- [x] Terminal: edit an open position from the Positions tab: stop loss / take profit as prices (set, change or remove), dollar and pip result at each level, "Stop to break-even", same-side checks as the engine before sending, warning when the stop is beyond the room left before the loss limit, partial close by lots; "Progress on this account" card on the Account tab (target, days, best day vs 40%, open positions, what's still needed) (2026-11-07)
- [x] Terminal: edit a pending order from the Pending orders tab: move the price, set/change/remove stop loss and take profit, pips from the market, dollar result at each level after the fill, loss-limit warning; engine `modifyOrder` + venue + all gateways + `PATCH /v1/accounts/{id}/orders/{orderId}` (2026-11-07)
- [x] Engine: server host skeleton for the HTTP contract (`src/engine/host.ts`, not imported by the site): token check, account ownership, tradingEnabled switch for opening/changing orders, strict bodies, error codes to HTTP statuses; tested end to end against HttpGateway (2026-11-07)
- [x] Engine: Firestore AccountStore adapter (`src/engine/firestore-store.ts`, transaction lock on `sequence`, size/shape/id checks) and QuoteFeed adapter template (`src/engine/quote-feed.ts`, symbol mapping, price validation, reconnect backoff, health for /v1/status) with tests (2026-11-07)
- [x] Engine: old deal history moves out of the account document before the store limit: `archiveHistory` (core, pure) keeps the newest deals and an `archived` summary (count, net, daily results for the best-day rule, recent client ids for retries, deal numbering); `FirestoreAccountStore` writes the moved deals to `engineAccounts/{id}/history/{000000…}` in the same transaction above 600 KB, `archivedDeals()` reads them back; terminal History tab says how many older trades are archived, their dates and net result (2026-11-08)
- [ ] Engine: `GET /v1/accounts/{id}/history?chunk=n` in host.ts + HttpGateway so the terminal can page through archived deals
- [ ] Account number + password sign-in emailed after purchase (owner request 2026-11-07): needs backend credential issuing and an owner-approved release; today the site deliberately emails no passwords
- [ ] Positions/History tabs: fill from the production ledger when trading opens

## Dashboard (/dashboard/*)
- [x] Dashboard home (/dashboard): "Your rules in dollars" for the active challenge (phase target and balance, daily loss limit, static maximum-loss floor, minimum days; profit split and payout requests for funded accounts), Phase 1 → Funded path with the current step, later phases' targets, live countdown to the 22:00 UTC reset in local time, and four tools preloaded with the account's size/program/phase; sizes outside the published schedule get a plain note pointing to Objectives (2026-11-07)
- [x] Dashboard home with no active challenge: "Plan before you buy" links to Find your challenge, the risk planner and the pass simulator (2026-11-07)
- [x] Dashboard home: funded accounts get the main card (funded first, then evaluations), switcher when there are several live accounts, stage counts (funded / in evaluation / passed in review / ended), per-account shortcuts (workspace, payouts or objectives, terminal, analytics), passed-in-review notice; fixed the credentials card showing an empty "Password" (passwords are never stored), copy buttons for server and login (2026-11-07)
- [x] Trades: Breakeven filter (was missing), Buy/Sell and session filters, "Clear filters", sortable columns with screen-reader order, totals that follow the filters, wins/losses/average/largest row, filtered CSV export (2026-11-04)
- [x] Trades: losing P/L showed as "$-80.00"; now "-$80.00" (2026-11-04)
- [x] Trades: open/close times were raw computer timestamps ("2026-11-02T09:00:00.000Z"); now readable ("Nov 2, 10:00") in the trader's local time with a Local/UTC switch that is remembered; CSV export headers say the times are UTC (2026-11-04)
- [x] Analytics: "When you trade best": closed P/L by weekday or by hour, local time or UTC, strongest/weakest time (only with 3+ trades), small-sample warning and a numbers table (2026-11-04)
- [x] Analytics: "P/L by trading day" (22:00–22:00 UTC, same window as the daily loss limit): up/down/flat days, average, best and worst day, bar chart of the last 30 trading days, best-day share vs the 40% rule (labelled estimate, links to Objectives), full day list (2026-11-04)
- [x] Analytics: trade-quality row (average win/loss, payoff ratio, longest win/losing streak, distance below peak); these were calculated but never shown (2026-11-04)
- [x] Analytics "Data status": trading-day count used calendar dates; now uses the 22:00 UTC trading day like the rules engine (2026-11-04)
- [x] Analytics: "Instruments by session" table: net P/L, trades, win rate, average, best/worst and buy/sell count per instrument, split into Asia/London/New York, with totals, sorting, "show all" and strongest/weakest combination (only with 3+ trades) (2026-11-05)
- [ ] Analytics: R-multiple distribution once risk data is reliable
- [x] Account workspace (/dashboard/accounts/:id) Analysis tab: now has the instruments-by-session table, "When you trade best" and "P/L by trading day" for that one account (2026-11-05)
- [x] Account workspace: date-range filter (7D/30D/All) on the Analysis tab, with "showing X of Y closed trades" and a clear empty-period message (2026-11-05)
- [ ] Walk signed-in pages with emulator data; check empty states on mobile
- [x] Fixed: account analysis said "1 closed trades" (2026-11-05)
- [x] Fixed: Profit factor showed the word "Infinity" when an account had no losing trades (Analytics and Account MetriX); now "No losses yet" (2026-11-06)
- [x] Fixed: Account MetriX showed the closed-trade drawdown as a gain ("+$120.00"); now "$120.00" like Analytics. "General statistics" showed "+$0.00" for average profit/loss and a best session when there were no such trades; now "—" (2026-11-06)
- [x] Account workspace Analysis: long/short comparison now shows result, trades and share, win rate, wins/losses and average per trade for each side, a plain comparison once each side has 3+ trades, and "?" help (new glossary term "Long and short") (2026-11-06)
- [x] Dashboard Analytics: the same long/short comparison (result, trades and share, win rate, wins/losses, average per trade, comparison once each side has 3+ trades) for the recorded trades, following the 7D/30D/All range; one shared card with the account Analysis tab (2026-11-07)
- [x] Tests covering public marketing pages render (Index, Challenges, Rules, Payouts): already covered by home-tools, challenge-finder, rule-calculator and how-it-works-payouts tests (checked 2026-11-07)
