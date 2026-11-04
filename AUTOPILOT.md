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
- [ ] Let "Start challenge" preselect size/program in the builder (needs care: builder feeds checkout)

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
- [ ] Trading-day clock: optional "Add the daily reset to my calendar" (.ics, recurring daily)
- [ ] Show the planner's daily pace against the trader's real progress on the dashboard (needs verified evaluation data)

## Payouts (/payouts)
- [x] Payout split estimator from approved profit-split table, clearly labelled estimate (2026-11-03)
- [x] Fix incomplete profit-split tiers: full size × program table from the catalog (2026-11-03)
- [x] Payout calendar: live "next request window" card based on today's date, linkable as /payouts#calendar (2026-11-03)
- [x] "Add both windows to my calendar" (.ics download for the next two request windows) (2026-11-04)

## FAQ (/faq)
- [x] Search, FAQPage structured data, related links and "Email support" block (2026-11-03)
- [x] Questions grouped by topic with filter chips; 13 new answers (reset time, loss floors, consistency, targets, days, split, payout windows, verification) with figures pulled from the published schedule (2026-11-03)
- [x] Each question has its own shareable link (/faq#question-id) and a next-step link (2026-11-03)
- [x] Home FAQ preview: curated questions from the real FAQ, each linking to its answer (/faq#id) (2026-11-04)

## Legal pages (/terms, /privacy, /risk-disclosure, /refund-policy, /aml-kyc)
- [x] Table of contents with anchor links and "last updated" date (already present; verified 2026-11-03)
- [x] "Back to contents" link after each section (2026-11-04)

## Certificate verification (/certificates/verify)
- [x] Public lookup page: enter an ID or paste a verification link; IDs are tidied (spaces, lower case, full links) (2026-11-04)
- [x] Site header/footer, "Copy verification link", status-checked time, "Try again" when the lookup is unavailable, help when not found, "What a verified certificate tells you" (2026-11-04)
- [x] Linked from the footer and a new FAQ answer (/faq#certificate-verification) (2026-11-04)
- [ ] Add /certificates/verify to the search-engine page list (needs a static render route; check the Vercel rewrite first)
- [ ] Learning certificates: hide rows that don't apply (passed/funded date, profit split) instead of showing "—"

## Dashboard (/dashboard/*)
- [x] Trades: Breakeven filter (was missing), Buy/Sell and session filters, "Clear filters", sortable columns with screen-reader order, totals that follow the filters, wins/losses/average/largest row, filtered CSV export (2026-11-04)
- [x] Trades: losing P/L showed as "$-80.00"; now "-$80.00" (2026-11-04)
- [x] Trades: open/close times were raw computer timestamps ("2026-11-02T09:00:00.000Z"); now readable ("Nov 2, 10:00") in the trader's local time with a Local/UTC switch that is remembered; CSV export headers say the times are UTC (2026-11-04)
- [x] Analytics: "When you trade best": closed P/L by weekday or by hour, local time or UTC, strongest/weakest time (only with 3+ trades), small-sample warning and a numbers table (2026-11-04)
- [x] Analytics: "P/L by trading day" (22:00–22:00 UTC, same window as the daily loss limit): up/down/flat days, average, best and worst day, bar chart of the last 30 trading days, best-day share vs the 40% rule (labelled estimate, links to Objectives), full day list (2026-11-04)
- [x] Analytics: trade-quality row (average win/loss, payoff ratio, longest win/losing streak, distance below peak); these were calculated but never shown (2026-11-04)
- [x] Analytics "Data status": trading-day count used calendar dates; now uses the 22:00 UTC trading day like the rules engine (2026-11-04)
- [ ] Analytics: P/L by instrument × session matrix; R-multiple distribution once risk data is reliable
- [ ] Account workspace (/dashboard/accounts/:id) Analysis tab: reuse the timing and trading-day cards
- [ ] Walk signed-in pages with emulator data; check empty states on mobile
- [ ] Add tests covering public marketing pages render (Index, Challenges, Rules, Payouts)
