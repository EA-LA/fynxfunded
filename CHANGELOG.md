# Changelog

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
