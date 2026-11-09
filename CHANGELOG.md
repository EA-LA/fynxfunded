# Changelog

## 2026-11-09 04:30 UTC — [autopilot] Dashboard: see your FYNX Trade account live

- New "Live on FYNX Trade" card on the Overview tab of each FYNX Trade account in the dashboard (open it from https://www.fynxfunded.com/dashboard/accounts). Once the trading engine is connected it shows, refreshed every few seconds: the account's state (active, target met and waiting for review, or closed by a loss limit), balance, equity, open profit/loss, open and pending trades, how many dollars are left before the daily loss limit and the maximum loss (with the equity level that would close the account, how much of the allowance is used, and which limit is closer), a table of the open trades with their stop loss, take profit and current result, and the same "Progress on this account" checklist as the terminal.
- The Balance and Equity boxes at the top of the account page switch to the live figures and say "live" while the engine is connected.
- Today the engine is not connected, so the card says that plainly and shows no numbers; nothing is estimated. Accounts on other platforms are unchanged.
- Nothing to build when you switch on: it turns on with the same setting as the terminal (docs/ENGINE-READINESS.md).

## 2026-11-09 00:30 UTC — [autopilot] FYNX Trade + Dashboard: risk and results in R

- Fixed: the trade journal (https://www.fynxfunded.com/dashboard/trades) showed "0.0%" risk and "0.0" R:R for trades where that was never recorded, which read as "no risk taken". It now shows "—", and the account's "Avg. R:R" (https://www.fynxfunded.com/dashboard/accounts) only averages trades that really recorded it.
- New "Results in R" card on https://www.fynxfunded.com/dashboard/analytics and on each account's Analysis tab: how many times their risk each trade won or lost (average, median, best, worst, total), a chart from −2R to +3R, how many losses went past the stop, and a plain reading once there are 5 trades. It says how many trades it is based on and stays empty rather than guess.
- FYNX Trade now remembers the risk every trade opened with (its stop loss in dollars and as % of the balance), even if the stop is moved later. When the engine is switched on, every trade closed on https://www.fynxfunded.com/trade/access arrives in the journal with its risk %, planned R:R and result in R filled in, and the terminal's History tab shows each trade's result in R.
- Nothing is switched on; this is ready for when the price feed and server are connected (docs/ENGINE-READINESS.md).

## 2026-11-08 20:40 UTC — [autopilot] FYNX Trade trades now flow into the FYNX Funded dashboard

- When the trading engine is switched on, every trade closed on FYNX Trade (https://www.fynxfunded.com/trade/access) is saved straight into the trader's FYNX Funded trade journal, so it appears on https://www.fynxfunded.com/dashboard/trades, in Analytics and in the account workspace with no extra building.
- Each trade is saved exactly once, even if the server restarts or the save has to be retried; if saving fails, the trade is kept aside and can be sent again later.
- The trade journal now says which trades came from FYNX Trade and how each one was closed (stop loss, take profit, closed by you, loss limit); the CSV export includes both.
- Nothing is switched on: this is ready for when the price feed and server are connected (steps in docs/ENGINE-READINESS.md).

## 2026-11-08 16:30 UTC — [autopilot] FYNX Trade: the engine can now go on a real web server as-is

- The trading engine now comes with its own web-server plug: whoever hosts it (Cloud Run, a Node server or a Firebase function) only adds one line, and the terminal on www.fynxfunded.com can talk to it straight away. Before this, a browser would have refused to connect to a separate engine address.
- Only the FYNX websites you list may use the engine from a browser; any other website is turned away before anything runs. Oversized or malformed requests are refused with a clear message.
- All engine settings (leverage, commission, maximum lots, allowed websites, overnight swap rates, holiday closures) are now filled in as settings on the host instead of in code. If anything is missing, the engine refuses to start and lists every missing item in one message.
- A purchased account now opens in the engine by itself the first time its owner loads it in the terminal, with the right balance and rules (no extra setup step).
- A health address for uptime monitoring shows only whether prices and order checks are live.
- The exact host file to run is written out in the engine readiness guide. Nothing was switched on: trading stays off and the terminal at https://www.fynxfunded.com/trade/access still says "Engine not connected" until you connect it.

## 2026-11-08 12:20 UTC — [autopilot] FYNX Trade: the server now watches every account by itself
- Stop losses, take profits, pending orders and the loss limits are now checked by the trading server every second and the moment a new price arrives, even when nobody has the terminal open. Before, this only happened when someone was clicking. It switches on together with the price feed; nothing is live yet.
- Everything the trading server needs (prices, accounts, the automatic checks and the address the terminal talks to) now starts with one call, so connecting it is a short job once the price feed and server are chosen. The exact steps are in docs/ENGINE-READINESS.md.
- The terminal's status badge now has a fourth state, "order checks paused", for when prices arrive but the server's automatic checks are behind. If you try to place an order then, the review explains why it wasn't sent. It used to show an empty line. See https://www.fynxfunded.com/trade/access

## 2026-11-08 08:18 UTC — [autopilot] FYNX Trade: browse every archived trade; Payouts shows your own profit split

- Trading terminal (https://www.fynxfunded.com/trade/access), History tab: when older trades have been moved to the account archive, a "Show older trades" button now loads them right into the list, one page at a time (newest first). Each page has a heading with its dates, number of trades and net result; at the end it says "All … archived trades shown". If a page can't be loaded you see a plain message and can try again.
- Ready for when the trading server is connected: the server address that hands out these archive pages is built, checks who is asking and which account it is, and is tested end to end with the real account storage. The terminal refuses a page that doesn't belong to the account instead of showing it.
- Dashboard → Payouts (https://www.fynxfunded.com/dashboard/payouts): funded traders now see their own profit split (for example "85% · Your $50,000 2 phase plan") instead of "Up to 90%", plus a "Your profit split" table with every funded account, its split and a worked example of what you and FYNX each get from $1,000 of approved profit (clearly marked as an example). Traders without a funded account still see the general "Up to 90%".
- Nothing was switched on; trading stays off until the owner connects it.

## 2026-11-08 04:16 UTC — [autopilot] FYNX Trade: accounts can trade for years without hitting a storage limit

- Ready for when the trading server is connected: each trading account is saved as one record, and records have a size limit. Before, an account with thousands of closed trades would eventually have been refused. Now the oldest closed trades are moved, automatically and safely in the same save, into numbered archive pages next to the account, and the newest 300 stay on the account.
- Nothing is lost: the balance, trading days, the 40% best-day rule and the "Progress on this account" card give exactly the same answers after older trades are archived, a repeated order from a dropped connection is still recognised, and every archived trade can be read back.
- Trading terminal (https://www.fynxfunded.com/trade/access), History tab: when older trades are archived it now says how many, between which dates, and their net result, and that they still count toward your balance and progress.
- Nothing was switched on; the setting and its defaults are written down in the engine guide for the owner.

## 2026-11-08 00:20 UTC — [autopilot] FYNX Trade: each pair shows when its market is closed, and edits explain it before you save

- Trading terminal (https://www.fynxfunded.com/trade/access): when a pair's market is closed, Market Watch shows a small lock next to it, with the reason when there is a special one (for example a holiday). Hover or tap it to read when it opens in your own time.
- The order panel now follows the pair you have selected, so a pair closed for a holiday says so ("USDJPY market closed · Tokyo holiday") even when the rest of the forex market is open.
- When you edit a position or a pending order while its market is closed, the editor now tells you straight away that it is closed, why, and when it opens (your time, with a countdown). Saving, closing part of a position and the Close button wait until the market opens, instead of sending and getting refused. Cancelling a pending order still works at any time.
- Ready for when the trading server is connected: it now reports, for every pair, whether its market is open, why not, and when that changes. Holiday and maintenance closures from the price provider only need to be entered once and they appear in the terminal. The terminal checks this every minute. Nothing was switched on.

## 2026-11-07 20:30 UTC — [autopilot] FYNX Trade knows when the market is open; overnight swap is ready

- FYNX Trade terminal (https://www.fynxfunded.com/trade/access): when the forex market is closed (like this weekend) the order panel now says so clearly, shows when it opens in your own time zone and in UTC, and counts down to it ("in 1d 10h 00m"). No order can be confirmed while the market is closed.
- The open/closed badge on the terminal and on https://www.fynxfunded.com/trade now follows the real forex week (Sunday 17:00 to Friday 17:00 New York time), including the summer/winter clock changes.
- Positions and History tables have a new "Swap" column, and a position's profit includes its swap.
- Behind the scenes (ready for when trading is switched on): the trading engine refuses to open, change or close trades while a market is closed, does not fill or stop out on weekend prices, and after a weekend gap fills stops at the first real price, the way real markets do. It also charges or pays overnight swap at the daily 22:00 UTC reset (three nights on Wednesday, none on weekends) as soon as the broker's swap rates are entered. Holiday closures can be added too.

## 2026-11-07 16:20 UTC — [autopilot] Dashboard home shows funded accounts; price feed and account storage ready to plug in

- Dashboard home (https://www.fynxfunded.com/dashboard): funded accounts now get the main card (before, only accounts still in evaluation did, so a funded trader saw "No active challenges"). With more than one live account you can switch between them. A row of counts shows funded, in evaluation, passed and in review, and ended accounts. Each account has shortcuts to its workspace, payouts (funded) or objectives (evaluation), the FYNX Trade terminal and analytics. Passed accounts get a short "in review" note.
- Fixed: the trading credentials card showed a blank "Password" when revealed. It now says passwords are never shown or stored on the dashboard, and the server and login have copy buttons.
- Engine readiness: the licensed price feed now only needs its connection and message format written; the template already checks every price (no fills on missing, crossed, too-wide, future or out-of-order prices), reconnects on its own and reports whether prices are live. Account storage in Firestore is built with the lock that stops two requests overwriting each other. Nothing is switched on; see docs/ENGINE-READINESS.md.

## 2026-11-07 12:20 UTC — [autopilot] FYNX Trade: edit pending orders; the trading server's front door is built

- Pending orders tab in the terminal (https://www.fynxfunded.com/trade/access): each waiting order now has an edit button. Move the order price, add, change or remove the stop loss and take profit, and see how many pips the order sits from the market and what each level would make or lose in dollars once it fills. Wrong-side prices are explained before anything is sent, and a stop bigger than the room left before the loss limit is flagged.
- The trading engine can now change a pending order with the same safety checks as a new order.
- The server side of the trading connection is ready as code: it checks the trader's sign-in, that the account is theirs, and that trading is switched on before opening or changing anything (closing and cancelling always work). When the price feed and server are plugged in, this is the piece that answers the terminal. Nothing was switched on or deployed.

## 2026-11-07 08:17 UTC — [autopilot] FYNX Trade: edit open trades, partial close and a progress card with the 40% best-day rule

- In the trading terminal (https://www.fynxfunded.com/trade/access), each open position now has an edit (pencil) button next to Close. It opens a panel where you can:
  - set, move or remove the stop loss and take profit as prices;
  - see what you would make or lose in dollars (and pips) if each level is hit;
  - move the stop to break-even with one click when the trade is in profit;
  - get a warning when a stop sits further away than the room left before your loss limit;
  - close part of the position (for example 0.40 of 1.00 lots).
  Wrong-side levels are explained before anything is sent.
- The Account tab gets a "Progress on this account" card: profit against the target, trading days, your best day against the 40% best-day rule, open positions, and a plain list of what is still needed.
- The trading engine now checks the 40% best-day rule before it reports a profit target as reached, the same way FYNX Funded's official review does. It can also read an account's purchased rules directly. Both are tested and written up in the engine readiness guide.
- All of this works as soon as the trading engine is connected. Until then the terminal still sends nothing.

## 2026-11-07 07:50 UTC — FYNX Trade home page: new premium design

- https://www.fynxfunded.com/trade has a new design of its own: a dark product look with a warm gold accent, a lit-up headline ("Trade the world's currencies with precision.") and a large, detailed picture of the trading screen.
- New "Global market hours" board: Sydney, Tokyo, London and New York with their local time, open/closed, a bar showing how far through the day each centre is, and when it opens or closes. It also shows UTC time, whether forex is open and the countdown to the daily reset.
- New sections:
  - "The platform" cards: order panel, risk in dollars, charts, Market Watch, phone.
  - "The FYNX engine": how orders are checked and how loss limits are enforced.
  - A restyled markets table for all 45 pairs, getting-started steps with shortcuts to the trading tools, and a partner section for prop firms and brokers.
  - Rounded FAQ and a closing "Your desk is ready." call to action.

## 2026-11-07 07:30 UTC — The FYNX trading engine is built and wired into FYNX Trade

- The trading engine behind FYNX Trade is ready. It:
  - checks every order and fills it at the bid/ask;
  - fills limit and stop orders when the price is reached;
  - closes positions at stop loss and take profit;
  - works out profit in dollars for all 45 pairs, plus equity, margin and free margin;
  - resets the trading day at 22:00 UTC;
  - closes everything and locks the account when the daily or maximum loss limit is hit;
  - reports the profit target for review.
- The trading screen (https://www.fynxfunded.com/trade/access) is connected to it:
  - an engine status light ("Engine not connected" today);
  - live bid/ask on the SELL/BUY buttons;
  - a "Confirm buy/sell" step before an order is sent;
  - open positions with a close button, pending orders with cancel, and closed-trade history;
  - margin, margin level and room to the loss limit in the top bar.
- Nothing is sent until you plug in a licensed price feed and the server and switch trading on for an account. docs/ENGINE-READINESS.md lists exactly what to connect.

## 2026-11-07 06:45 UTC — FYNX Trade home page redesigned in the FYNX Finance World style

- https://www.fynxfunded.com/trade now looks like FYNX Finance World:
  - A black top bar with today's date and time in UTC.
  - A "FYNX / TRADE PLATFORM" wordmark, sharp square buttons and deep-green highlights.
  - Small upper-case section labels, numbered items with arrow links, thin grid lines and a dark footer with link columns.
- A new live market-hours bar under the menu shows:
  - whether the forex market is open and how long until the daily reset;
  - Sydney, Tokyo, London and New York with their local time and "Open · closes in…" / "Opens in…".
  - It's worked out from your own clock, with daylight saving handled.
- "Find a forex pair" search in the first screen: type EUR/USD, "yen" or "GBP" and open the pair straight in the terminal. Popular pairs sit underneath.
- "Start with what you need" list: open the terminal, get an account, size your next trade, partner with FYNX Trade.
- Markets is now a proper table of all 45 pairs: symbol, name, group, pip size, digits, lot size and pip value. You can filter by group, type to search, and open any pair with "Trade ↗".
- The terminal picture now sits in a dark section; the FAQ has rounded question cards with + / − buttons.

## 2026-11-07 06:00 UTC — FYNX Trade gets its own home page

- "Trade Now" on the FYNX Funded site now opens FYNX Trade's own home page at https://www.fynxfunded.com/trade. It has its own FYNX Trade logo, menu and footer, and its sections are:
  - A hero with "Trade now" and a drawn picture of the terminal.
  - Key numbers: 45 forex pairs, 6 chart timeframes, 0.01 lot minimum, no download.
  - The platform on desktop and phone, the features, and "How it works" (get an account → check your email → open FYNX Trade).
  - All 45 pairs, each opening in the terminal.
  - A "For prop firms & brokers" partnership section.
  - Questions and answers, plus a clear risk notice.
- Every "Trade now" button opens the trading terminal at https://www.fynxfunded.com/trade/access. Sign-in is asked for first if needed.
- The FYNX menu (the grid button next to the logo) now lists FYNX Trade next to FYNX Funded and marks the one you're on.

## 2026-11-07 05:20 UTC — FYNX Trade is now a full trading screen (like MT5)

- https://www.fynxfunded.com/trade has been rebuilt as a trading terminal. You'll see:
  - Market Watch with all 45 forex pairs (7 majors, 21 minors, 17 exotics). You can search by symbol or currency name ("yen", "rand"), filter by group, and star favourites.
  - A live TradingView chart and live price for the pair you pick, with 1m–1D timeframes and a live ticker for the main pairs. These load after you agree once, and that choice is remembered on the device.
  - An order panel with big red SELL and blue BUY buttons, market/limit/stop types, a lot picker (− / + and 0.01/0.10/0.50/1.00), and stop loss and take profit in pips. It shows contract size, pip size and pip value, and the dollar risk and profit at your stop and target. It also says how much of your daily loss limit one stop would use.
  - An account bar (balance, equity, floating P/L, margin, free margin, phase), forex market open/closed, and a countdown to the daily reset.
  - Positions, Pending orders, History and Account tabs, including your rules in dollars and the account email status.
  - On phones, an MT5-style bottom menu: Quotes, Chart, Trade, History, Account.
- Orders are not sent yet. Pressing BUY or SELL shows the order summary and says that trading isn't switched on for the account. Turning on real trading needs a licensed price feed, the production trading server and an approved backend release.

## 2026-11-07 05:00 UTC — Log in goes straight to the dashboard; second owner account prepared

- After logging in you now go straight to the dashboard (https://www.fynxfunded.com/dashboard) instead of the "Purchases and trading are paused" page. Accounts that don't have Funded access are still sent to that page automatically.
- The server rules now accept ha6876122@gmail.com as a second owner account next to fynxteam5@gmail.com. It still needs the same protections: an operator-set owner flag, its account ID added to the private access settings, and an email + password sign-in. A new script (scripts/grant-funded-owner.cjs) sets the flag and adds the ID. These changes only work after the backend is redeployed, and the "Funded access check" server function, which isn't in this code, also has to allow the new email.

## 2026-11-07 04:20 UTC — [autopilot] Dashboard home: your rules in dollars, today's reset countdown and tools set to your account

- The dashboard home page now shows, for your active challenge, the rules of your purchase in dollars: the profit target for the phase you're in (and the balance to reach), the daily loss limit, the maximum loss floor and the minimum trading days, each with a "?" explanation. It also shows where the account is on its path (Phase 1 → Phase 2 → Funded) and what the later phases will ask for. Official progress stays on Objectives. See it at https://www.fynxfunded.com/dashboard
- A live countdown to the 22:00 UTC daily reset, with the reset time in your own time zone, sits under the rules.
- Four shortcuts open the rules calculator, risk planner, position size calculator and pass simulator already set to your account size, program and phase.
- With no active challenge, the dashboard home now offers "Plan before you buy" links: Find your challenge, the risk planner and the pass simulator.

## 2026-11-07 00:30 UTC — [autopilot] Lot sizes for cross pairs like GBP/JPY and EUR/GBP; long vs short on dashboard Analytics

- The position size calculator on the Trading rules page now handles forex pairs without the US dollar (EUR/GBP, GBP/JPY, EUR/JPY, AUD/CAD, EUR/CHF, AUD/NZD and more). Pick "Forex cross pair", choose the second currency, type the matching US-dollar price from your platform, and it shows the lot size, the dollar value of a pip and the loss at your stop. The share link keeps the pair type. See it at https://www.fynxfunded.com/rules?inst=cross&qc=JPY#position-size
- The FAQ answer "How do I work out my lot size?" now explains cross pairs with a worked example: https://www.fynxfunded.com/faq#lot-size
- Dashboard Analytics now has the long/short comparison (Buy vs Sell results, win rate, wins/losses, average per trade and a plain comparison), following the 7D/30D/All range: https://www.fynxfunded.com/dashboard/analytics

## 2026-11-06 20:30 UTC — [autopilot] "What could getting funded cost?" in the pass simulator, fee check in the payout estimator, better long/short stats

- New under the pass simulator results on https://www.fynxfunded.com/rules#simulator (choose "All phases", or any 1-phase program): the challenge fee per attempt, how many attempts your plan would take on average, the fees that adds up to, the funded profit your share would need to earn them back, and your chance of being funded within 1, 2, 3 or 5 attempts (with the most it could cost in fees). It warns plainly when the plan never passes. Example link: https://www.fynxfunded.com/rules?size=25000&program=2-phase&sphase=all#simulator
- If you simulate only one phase, a "Simulate all phases" button switches to the full picture in one tap.
- The payout estimator on https://www.fynxfunded.com/payouts#estimator now compares your estimated share with the challenge fee: "Your share would cover the $199 fee for this challenge 4 times", or how far short it is and the profit that would cover it.
- New FAQ answer "How much could getting funded cost me in fees?" at https://www.fynxfunded.com/faq#funding-cost, and two new glossary words: "Challenge fee" and "Long and short".
- Dashboard, each account's Analysis tab: the long/short comparison now shows, for buys and sells separately, the result, number of trades and share, win rate, wins/losses and average per trade, a plain sentence saying which side is doing better (once each side has 3+ trades), and tap-to-explain help.
- All figures use the published fees and profit splits; they are illustrations that assume the same odds every attempt and no refund or discount.

## 2026-11-06 16:25 UTC — [autopilot] "How long will it take?" in Find your challenge, word help on Trades and account stats

- Find your challenge (https://www.fynxfunded.com/challenges#finder) now asks, optionally, how many days a week you can trade. Each suggested plan then shows the earliest it could take to get through its minimum trading days at that pace (for example "5 weeks+" for a 3-phase plan at 3 days a week), with the same figure in the reasons and in the full list. It is clearly a minimum: there is no time limit, and reaching the profit target often takes longer. The choice is kept in the share link.
- Dashboard Trades page: a small "?" beside Lots, Pips, Risk %, R:R and Session in the table header (sorting still works by tapping the column name), and beside Win rate and Volume, opens a plain explanation with a link to the glossary.
- Each account's "Account MetriX" tab: the same "?" help on Win rate, Profit factor, Avg. R:R, Closed-trade drawdown and on the "General statistics" list (average profit/loss, expectancy, best session).
- Two new glossary entries, "Profit factor" and "Expectancy" (https://www.fynxfunded.com/faq#term-profit-factor and https://www.fynxfunded.com/faq#term-expectancy), also explained on dashboard Analytics.
- Fixed: Profit factor showed the word "Infinity" for an account with no losing trades; it now says "No losses yet".
- Fixed: the account "Account MetriX" tab showed the drawdown as if it were a gain ("+$120.00"); it now shows "$120.00", matching Analytics. Average profit, average loss and best session now show "—" instead of "+$0.00" when there are no such trades.
- See it (after logging in): https://www.fynxfunded.com/dashboard/trades and any account under https://www.fynxfunded.com/dashboard/accounts

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
