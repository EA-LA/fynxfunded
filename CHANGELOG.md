# Changelog

## 2026-11-06 12:30 UTC — [autopilot] "Find your challenge" on the Challenges page

- New "Find your challenge" tool on the Challenges page. Type the most you want to pay, your usual risk per trade in dollars, and pick what matters most (lowest fee, best value, most room, fewest days, largest account or best profit split).
- It checks all 18 published plans and shows the best three that fit, each with its fee, profit to make, daily and maximum loss in dollars, minimum days, profit split, plain reasons ("5 full losses fit in one day at $100 a trade") and honest warnings (tighter limits on 1-phase, more days on 3-phase). "Show all" lists every plan that fits.
- If nothing fits, it shows the closest options and what would need to change (for example "risk $83.33 or less per trade", or how far above your budget the nearest plan is).
- Each plan links to its rules in dollars and to the risk planner preloaded with your risk. "Copy a link to these choices" shares the exact search.
- Also linked from the Challenges intro, the home page plan cards and the FAQ answer about the 1-, 2- and 3-phase programs.
- See it: https://www.fynxfunded.com/challenges#finder

## 2026-11-06 08:25 UTC — [autopilot] Replay your own dashboard trades day by day against the challenge rules

- New "Your journal, replayed day by day" box on the dashboard Analytics page and on each account's Analysis tab. It plays your real closed trades back in the order they closed, day by day, against the published rules, and tells you the exact day you would have passed a phase, broken a loss limit, or what was still missing (profit, days, the 40% best-day rule).
- Pick any account size, program and phase (or all phases in a row). It follows the 7D / 30D / All buttons, shows a balance chart against the target and loss floors and a row for every trading day. It is clearly marked as practice, not your official status, and links to your real Objectives.
- Dashboard Objectives: tap any objective name (Profit Target, Daily Loss Limit, Max Loss Limit, Min Trading Days, Consistency Rule) or the "?" next to the planned-risk slider for a plain explanation, plus a link to replay your journal.
- Dashboard Analytics: "?" help next to Win rate, Closed-trade drawdown, Payoff ratio and Below peak now.
- See it (after logging in): https://www.fynxfunded.com/dashboard/analytics and https://www.fynxfunded.com/dashboard/objectives. The paste-your-own version stays at https://www.fynxfunded.com/rules#replay.

## 2026-11-06 04:35 UTC — [autopilot] Replay your real trades day by day against the challenge rules

- New on https://www.fynxfunded.com/rules#replay: "Replay your record day by day". Paste or open your broker's trade history (a CSV with a close time and a profit column) and your real trades are played back in the order they happened, grouped into the same 22:00 UTC trading days the daily loss limit uses.
- It tells you plainly what would have happened on the account you pick: "passed phase 1 at the close of Fri, Oct 9", "the daily loss limit would have been broken on Wed, Oct 7" (with the balance, the floor and by how much), or, if the record runs out first, exactly what was still missing (more profit, more trading days, or a smaller best day for the 40% rule).
- You also see your closest call to a loss floor, a chart of your closing balance against the target and the floors, and a table with every trading day: trades, day result, closing balance, lowest allowed balance and room left.
- Choose any size and program, a single phase or all phases in a row, the time zone your broker's file uses (for example UTC+2 server time), the account size the trades were made on (results are resized) and extra charges. No dates? It replays the results in order, a chosen number per day.
- Your trades stay on your device: nothing is uploaded, saved or put in the share link. A "Try a made-up example record" button lets anyone try it.
- Linked from the top of the Rules page, the pass simulator's "own trade results" mode and the FAQ answer https://www.fynxfunded.com/faq#pass-odds

## 2026-11-06 00:20 UTC — [autopilot] "Am I ready to request a payout?" check, and word explanations on Challenges, How it works and Payouts

- New on https://www.fynxfunded.com/payouts#readiness: answer five quick questions (trading days since your last payout, net profit, rule violations, open positions, identity verification) and see which payout conditions you meet, what is still missing and exactly what to do about it, plus the request window to aim for (for example "Nov 16 – 18, opens in 6 days"). Your share is worked out with your plan's split against the $50 minimum. Nothing is saved or sent; every real request is still reviewed.
- The eligibility checklist on the Payouts page links to the new check, the FAQ answer "What do I need before requesting a payout?" now opens it, and the dashboard Payouts page has an "Am I ready to request?" link.
- On https://www.fynxfunded.com/challenges every plan card label (account size, phase targets, daily loss limit, max loss limit, minimum days, profit split) and every row of the "Compare all sizes" table is dotted: tap it for a plain explanation and a link to the glossary.
- On https://www.fynxfunded.com/how-it-works each step ends with a "Words used here" line (profit target, daily loss limit, maximum loss, static drawdown, minimum days, 40% rule; funded stage, profit split, payout window, KYC), the trading-day box explains trading day, daily reset and breach, and there is a link to the full glossary.
- Payouts page: profit split, the eligibility list and the payout calendar have the same tap-to-explain help.
- Fixed: the dashboard Payouts page said payouts were "Bi-weekly, every 14 calendar days", which contradicted the published calendar. It now says "Twice a month: requests open the 1st–3rd and 16th–18th (UTC)".
- Fixed: the Quick/Full and 1/2/3-phase switches above the comparison table on /challenges now tell screen readers which one is selected.

## 2026-11-05 20:25 UTC — [autopilot] Tap any rules word on the Rules page for a plain explanation

- On https://www.fynxfunded.com/rules, words such as "Daily loss limit", "Equity", "Consistency rule" and "Minimum days" are now dotted: tap or click one to see what it means in plain words, with a link to the full glossary entry and the right calculator.
- Every rule card ends with a "Words used here" line, and the calculators on the page (rules calculator, risk planner, pass simulator, position size calculator and daily-reset clock) have small "?" buttons beside their labels (risk per trade, stop loss, lot, take profit, win rate, break-even win rate, charges and more).
- A short note under the page intro explains the dotted words and links to the full glossary at https://www.fynxfunded.com/faq#glossary.
- Fixed: the browser tab said "Account" on the login, sign-up, certificate check, checkout and all dashboard pages. Each page now has its own tab name, for example "Log in", "Verify a certificate" or "Analytics · Dashboard".

## 2026-11-05 16:35 UTC — [autopilot] Replay your own trade results in the pass simulator

- The pass simulator on the Rules page has a new choice: "One of my own trade results". Paste your past profits and losses (one per line), or open a CSV export from your broker; the Profit / P/L column is found automatically.
- It shows what it read (wins, losses, win rate, average and biggest win and loss, net result) and then plays those real results forward 2,000 times against the challenge rules: how often you'd pass, how runs end and how many trading days it usually takes.
- Optional "account size these results were made on" resizes them to the account you're testing, and a warning appears if your biggest loss alone is bigger than the daily allowance.
- Your results stay on your device: nothing is uploaded, saved or included in the share link. A "Try made-up example results" button lets anyone try it.
- See it: https://www.fynxfunded.com/rules?smethod=own#simulator (also linked from the top of the Rules page and the FAQ answer https://www.fynxfunded.com/faq#pass-odds)

## 2026-11-05 15:20 UTC — [autopilot] Trading glossary on the FAQ page, and "replay my real trades" in the dashboard simulator
- New glossary at the bottom of the FAQ page: 36 trading and evaluation words (pip, lot, equity, daily loss limit, static vs trailing drawdown, consistency rule, profit split and more) explained in plain words, with search, filters by area, A–Z letters and a "go to the calculator" link on most terms. Every FYNX number comes from the published rules. See https://www.fynxfunded.com/faq#glossary
- Each word has its own link to share, e.g. https://www.fynxfunded.com/faq#term-pip opens the page on that word and highlights it.
- In the dashboard (Analytics, and each account's Analysis tab), "Your record in the pass simulator" can now replay the trader's real wins and losses instead of only the average ones. It shows their biggest win and loss, warns if the biggest loss alone would break the daily limit, and compares both pass rates side by side, so traders whose trade sizes vary a lot see a more honest picture.

## 2026-11-05 12:30 UTC — [autopilot] Test your own trading record in the pass simulator

- Dashboard Analytics has a new "Your record in the pass simulator" panel. It takes your own closed trades (your win rate, your average loss as the risk per trade, your average win as the reward, and how many trades you usually take a day) and plays that forward 2,000 times against the real challenge rules. You see how often it passes, how the other runs ended and how many trading days a pass usually takes. https://www.fynxfunded.com/dashboard/analytics
- Pick the account size, the program (1, 2 or 3 phases) and whether to test phase 1 or all phases. It follows the 7D / 30D / All buttons at the top of the page.
- It explains the result in plain words: if most runs ran out of time, or most hit the maximum-loss floor. It warns instead if one average loss would be bigger than the whole daily allowance at that size.
- "Open this in the pass simulator" carries your numbers to the full simulator on the Rules page, where you can change anything. https://www.fynxfunded.com/rules#simulator
- The same panel is on each account's Analysis tab (open an account from the dashboard, then Analysis), starting on that account's size and program.
- It only appears once there are at least 10 winning or losing trades, never rounds your reward up, and is clearly labelled as past results and an illustration, not a prediction. The FAQ answer "How likely is my trading plan to pass?" now mentions it. https://www.fynxfunded.com/faq#pass-odds

## 2026-11-05 08:30 UTC — [autopilot] Challenge pass simulator on the Rules page

- New "Challenge pass simulator" on the Rules page: enter your risk per trade, reward, win rate, trades per day and charges, and it plays that plan forward 2,000 times against the real rules (daily loss, maximum loss, minimum days, 40% consistency). You see how often it passes, how the other runs ended, how many trading days a pass usually takes, and the average result per trade. Works for one phase or all phases in a row. https://www.fynxfunded.com/rules#simulator
- Switch between a careful trader (stops before a loss could break a limit) and one who takes every planned trade, to see how a bad streak turns into a breach.
- "Run again" and "Copy a link to this simulation" buttons; the risk planner now has a "Test this plan in the pass simulator" button that carries your numbers over.
- New FAQ answer, "How likely is my trading plan to pass?": https://www.fynxfunded.com/faq#pass-odds
- Clearly labelled as a simplified illustration, not a prediction or advice; nothing is saved or sent.

## 2026-11-05 04:30 UTC — [autopilot] Position size calculator, and date ranges on each account's Analysis tab
- New "Position size calculator" on the Trading Rules page: choose your account, your risk per trade, the instrument (EUR/USD-style pairs, USD/CAD-style pairs, USD/JPY, gold, or any other instrument) and how far away your stop loss is, and it tells you how many lots to trade so a stopped-out trade stays inside your risk. https://www.fynxfunded.com/rules#position-size
- It also shows the loss at the stop including trading charges, how much of today's loss allowance that is, the target distance and profit at 1×–3× your stop, and warns you if your risk is smaller than the smallest possible position. Where a price is needed, you type the price from your own platform; the site never invents prices.
- "Copy a link to this calculation" saves the whole setup in a shareable address.
- The Risk and pace planner has a new "Turn this risk into a lot size" button that opens the calculator with the same account and risk. The FAQ has a new answer, "How do I work out my lot size?" https://www.fynxfunded.com/faq#lot-size
- Each account's Analysis tab (open an account from the dashboard, then Analysis) now has 7D / 30D / All buttons, like the main Analytics page, and says how many trades are included.
- Fixed: the account analysis said "1 closed trades".

## 2026-11-05 00:20 UTC — [autopilot] See which instruments and sessions work for you, per account too, and put the daily reset in your calendar
- Analytics has a new "Instruments by session" table: for every instrument you trade, your net result, number of trades, win rate, average per trade, best and worst trade and buy/sell count, split into the Asia, London and New York sessions, with totals at the bottom. Sort it by result, most traded, win rate or A–Z. https://www.fynxfunded.com/dashboard/analytics
- It calls out your strongest and weakest instrument + session combination, but only once a combination has at least 3 trades, so one lucky trade is never presented as a pattern.
- Each account's own page now has a much fuller Analysis tab: the same instruments-by-session table, "When you trade best" and "P/L by trading day", for that one account only (open an account from the dashboard, then choose Analysis).
- Trading-day clock: new "Add the daily reset to my calendar" button with a reminder choice (none, 15, 30 or 60 minutes before). It adds one event that repeats every day at 22:00 UTC and shows in your own time in Google, Apple or Outlook calendars. https://www.fynxfunded.com/rules#trading-day

## 2026-11-04 20:30 UTC — [autopilot] See when you trade best, day-by-day results, and readable trade times
- Analytics has a new "When you trade best" panel: your closed profit and loss by day of the week or by hour, in your own time or UTC, with your strongest and weakest times called out (only once there are at least 3 trades, with a reminder that small samples can mislead). https://www.fynxfunded.com/dashboard/analytics
- New "P/L by trading day" panel: each trading day runs 22:00–22:00 UTC like the daily loss limit. Shows up/down days, average day, best and worst day, a day-by-day chart, and how big your best day is compared with the 40% consistency rule (an estimate; the official status stays on Objectives).
- New row of trade-quality numbers: average win, average loss, payoff ratio, longest winning and losing streaks, and how far you are below your best point.
- The trading-day count in "Data status" now uses the same 22:00 UTC day as the rules.
- Trades: open and close times are now easy to read (for example "Nov 2, 10:00") in your own time zone instead of long computer timestamps, with a Local/UTC switch that the site remembers. https://www.fynxfunded.com/dashboard/trades

## 2026-11-04 16:30 UTC — [autopilot] A trading-day clock, and a much more useful Trades journal

- New "Trading-day clock" on the Rules page: shows the time now in UTC and in your own time zone, a live countdown to the 22:00 UTC daily reset (and what time that is where you live), and a 24-hour bar showing where today is. https://www.fynxfunded.com/rules#trading-day
- The clock lists the Asia / London / New York labels the dashboard uses for your trades, converted to your time, with a clear note that these are journal labels, not broker trading hours.
- "Check a time": pick any date and time in your own time zone and see which daily-loss period it counts against and how long before the next reset.
- The FAQ answer "When does the trading day reset?" now links straight to the clock. https://www.fynxfunded.com/faq#daily-reset
- Dashboard Trades page (signed in): you can now filter by Breakeven results (the option was missing), by Buy/Sell and by session, clear all filters in one click, and sort by symbol, close time, lots, pips, P/L, risk or R:R by clicking the column title. https://www.fynxfunded.com/dashboard/trades
- The totals at the top of Trades now follow your filters ("3 of 12 trades"), and a new row shows wins/losses/breakeven, average win, average loss and the largest win and loss. Exporting while filtered downloads just those trades.
- Fixed: losing trades showed their P/L as "$-80.00"; they now read "-$80.00".

## 2026-11-04 12:35 UTC — [autopilot] A public "Verify a certificate" page, and easier-to-read legal pages
- New page where anyone (an employer, a friend, a follower) can check that a FYNX Funded certificate is real: type the certificate ID or paste the link the trader shared, and the page shows whether it is valid and still active. https://www.fynxfunded.com/certificates/verify
- Certificate pages now have the normal site menu and footer, a "Copy verification link" button, the time the status was checked, and a short explanation of what a verified certificate means.
- If a certificate isn't found, the page explains what to check and how to contact support. If the check can't run for a moment, there's a "Try again" button instead of a dead end.
- "Verify a certificate" is linked from the footer of every page, and the FAQ has a new answer about it. https://www.fynxfunded.com/faq#certificate-verification
- Terms, Privacy, Risk Disclosure and Refund Policy: every section now ends with a "Back to contents" link, so long legal pages are easier to move around, especially on phones. https://www.fynxfunded.com/terms

## 2026-11-04 08:25 UTC — [autopilot] Shareable risk plans, and the risk planner linked from more pages

- The Risk and pace planner now has a "Copy a link to this plan" button. The link remembers the account size, program, phase, risk per trade, reward and number of days, so a trader can save a plan or send it to someone: https://www.fynxfunded.com/rules#risk-planner
- The home page "Know Your Numbers" section now has a fourth tool card for the risk planner: https://www.fynxfunded.com/#tools
- How It Works remembers the program and account size you pick in the address, so the page can be shared exactly as you see it, and has a new "Plan your risk per trade for this account" link: https://www.fynxfunded.com/how-it-works
- In the dashboard, the quick risk slider on the Objectives page now links to the full planner, opened on your account size and chosen risk: https://www.fynxfunded.com/dashboard/objectives

## 2026-11-04 04:20 UTC — [autopilot] Risk and pace planner on the Trading Rules page, plus a keyboard "skip" link

- New **Risk and pace planner** on the Trading Rules page: pick your account size, program and phase, type how much you'd risk on one trade (as a % of the account or in dollars) and choose a reward size. It shows how many losing trades fit before the daily and maximum-loss floors, warns if one loss alone would break the daily limit, how many winning trades the target takes, the break-even win rate, a steady daily profit pace, and the biggest single day that still fits the 40% consistency rule. All figures come from the published rules; it is planning arithmetic, not advice. See it at https://www.fynxfunded.com/rules#risk-planner
- The top of the Trading Rules page now links to both the rules calculator and the new planner.
- Every public page now has a "Skip to main content" link that appears when you press Tab, so keyboard and screen-reader visitors can jump past the menu.

## 2026-11-04 01:30 UTC — Removed the "FYNX Ecosystem" list from the page footer
- At your request, the long "FYNX Ecosystem" list of links no longer appears at the bottom of every page (including the dashboard). The FYNX sites are still one tap away in the grid menu next to the logo at the top. https://www.fynxfunded.com/

## 2026-11-04 00:25 UTC — [autopilot] Home page planning tools, rules in dollars, and "add to calendar" for payouts
- Home page plan cards now show the real numbers for each account: the phase 1 profit target, the daily and maximum loss allowance in dollars and the minimum trading days, with a "See these rules in dollars" link that opens the rules calculator already set to that plan. https://www.fynxfunded.com/
- New home page section "Know Your Numbers Before You Start" with one-click links to the rules calculator, the side-by-side program comparison and the payout estimator, plus the live next payout window. https://www.fynxfunded.com/#tools
- The home page FAQ now shows five of the most-asked questions from the full FAQ, each with a "Read in the full FAQ" link that opens that exact answer.
- Payouts page: new "Add both windows to my calendar" button downloads the next two payout request windows for Google, Apple or Outlook calendars. https://www.fynxfunded.com/payouts#calendar
- Fixed: opening a shared link to a section (for example https://www.fynxfunded.com/payouts#calendar or a FAQ answer link) used to leave you at the top of the page; it now jumps straight to that section.

## 2026-11-03 20:30 UTC — [autopilot] A much fuller FAQ and a live "next payout window"
- FAQ now has 21 questions sorted into four topics (Getting started, Rules & limits, Payouts, Account & purchases) with topic buttons next to the search box. New answers cover the 22:00 UTC daily reset, how the daily and maximum loss floors are worked out, the 40% consistency rule, profit targets, minimum trading days, profit split, payout requirements and windows, and identity checks, each with a worked dollar example taken from the published rules. https://www.fynxfunded.com/faq
- Every question can be shared with its own link (for example https://www.fynxfunded.com/faq#daily-reset opens that answer) and has a "next step" link to the right calculator or page.
- Payouts page: the calendar now shows whether a request window is open today, how many days are left or until it opens, and when approved requests are scheduled to be paid. https://www.fynxfunded.com/payouts#calendar
- Fixed: clicking a link in the footer used to open the next page scrolled to the very bottom; pages now open at the top, and links to a section (like the calculator) jump straight to it.
- Fixed: the support email in the footer is now clickable.

## 2026-11-03 16:20 UTC — [autopilot] Step-by-step program path and a payout estimator

- How It Works now lets you pick any program (1, 2 or 3 phases) and account size and shows every step in dollars: targets, loss limits, minimum days and the funded profit split. https://www.fynxfunded.com/how-it-works
- New "How a trading day works" box on the same page explains the 22:00 UTC reset and loss floors in plain words.
- Payouts now shows the full profit-split table for every size and program (the old three-tier box was incomplete), plus an estimator that splits a profit amount and checks the $50 minimum. https://www.fynxfunded.com/payouts#estimator

## 2026-11-03 12:30 UTC — [autopilot] Compare programs side by side, linked to the rules calculator
- The Challenges page (https://www.fynxfunded.com/challenges#compare-programs) has a new "Which program fits you?" section: pick an account size and see the 1, 2 and 3-phase programs next to each other in dollars: fee, each phase's profit target, total profit to make, daily and maximum loss, minimum trading days and profit split.
- Badges point out the lowest fee, the most room before the maximum loss and the fastest minimum, and every plan has a "Plan it in the rules calculator" / "See the rules in dollars" button.
- Those buttons open the Rules calculator already set to that size and program (for example https://www.fynxfunded.com/rules?size=50000&program=3-phase#calculator). The calculator now lets you pick which phase you're in, and the page address updates so you can share your setup.

## 2026-11-03 08:20 UTC — [autopilot] Rules calculator and searchable FAQ
- The Trading Rules page now has a Rules calculator (https://www.fynxfunded.com/rules#calculator): pick an account size and program to see each phase's profit target, the maximum-loss floor and the minimum trading days in dollars.
- Type your balance at the 22:00 UTC reset and it shows today's exact equity floor; enter your daily results and it tells you whether you meet the 40% consistency rule, and how much more profit you'd need if not.
- The FAQ (https://www.fynxfunded.com/faq) now has a search box, links to related pages and an "Email support" button. Google can also show the questions directly in search results.

## 2026-11-03 — [autopilot] Friendlier "page not found" screen
- Mistyped or outdated links (try www.fynxfunded.com/anything) now show a proper page with the normal menu and footer instead of a bare "404".
- The new page offers a "Back to home" button, a shortcut to your dashboard, and cards linking to Challenges, How it works, Rules and FAQ, plus the support email.
- Browser tabs now say "Page not found" instead of "Account", and these pages are kept out of Google.
- Footer fix: "Trade Now" in the Product column no longer sits cramped against "Payouts".
