# Changelog

## 2026-11-13 22:40 UTC — [autopilot] FYNX Trade: ready for a broker-style "margin stop out"

- If an account agreement sets a margin stop out (for example at 50 %), the trading server now handles it by itself: when the account's margin level falls to that level, it closes the trade with the biggest loss at the market price, then checks again, until the margin level is back above the level. It is not a rule breach: the account stays open and waiting orders are untouched.
- The daily and maximum loss limits still come first. Nothing is ever closed on an old or missing price, or while the market is closed.
- The trader gets one email listing every trade the stop out closed and the result (part of the "loss limit" email choice, which is on by default).
- In the terminal (https://www.fynxfunded.com/trade/access): a warning appears under the account bar when the margin level gets close (amber) or reaches the level (red), the Account tab lists "Margin stop out", and closed trades show "Margin stop out" in History, the statement download and the dashboard Trades page.
- Nothing changes for today's accounts: the rule only applies when the purchased rules contain `stop_out_level`. Steps in docs/ENGINE-READINESS.md ("Margin stop out").

## 2026-11-13 18:17 UTC — [autopilot] FYNX Trade: ready for "most lots / most trades open at once" limits

- If an account agreement caps how much a trader may have in the market at once (for example "at most 10 lots" or "at most 5 trades open together"), the trading server now enforces it by itself. An order that would go past the limit is refused with a plain explanation, including how much can still be added. Nothing is sent in that case.
- Pending orders that are waiting count too, so once accepted they can always fill. Two orders linked "one cancels the other" count once, because only one of them can ever open. Closing trades and cancelling orders always work.
- In the terminal (https://www.fynxfunded.com/trade/access): under the volume the order panel shows how much is open against the limit (for example "2.95 of 3.00 lots · 1 of 3 trades") and what it would be after this order, turns amber close to the limit, locks Confirm with the reason when the order would go past it, and the Account tab lists the limit under "Open at once".
- Nothing changes for today's accounts: the limits only apply when the purchased rules contain `max_open_lots` and/or `max_open_trades`. Steps in docs/ENGINE-READINESS.md ("Open-exposure limits").

## 2026-11-13 15:20 UTC — [autopilot] FYNX Trade: ready for a "no trades over the weekend" rule

- If an account agreement says trades may not be held over the weekend, the trading server now handles it by itself: a few minutes before the market closes on Friday (15 minutes unless you choose another number, 1 to 240), it closes that account's open trades at the market price. The account stays open; it is not a rule breach. Long holiday closures of a day or more count too.
- In those last minutes new market orders are refused with a plain explanation; pending orders can still be placed and simply wait for Sunday's reopen. Closing trades and cancelling orders always work.
- The trader gets one email listing every trade closed and the result (part of the "loss limit" email choice, which is on by default).
- In the terminal (https://www.fynxfunded.com/trade/access): from a day before, the order panel says when trades will close in the trader's own time (amber in the last hour), the Positions tab shows the same reminder while trades are open, the Account tab lists "Weekend holding: Not allowed", and closed trades show "Closed before the weekend" in History, the statement download and the dashboard Trades page.
- Nothing changes for today's accounts: the rule only applies when the purchased rules contain `weekend_holding: false`. Steps in docs/ENGINE-READINESS.md ("No weekend holding").

## 2026-11-13 08:45 UTC — [autopilot] FYNX Trade: choose whether waiting orders are held during a pause or big news

- Two open owner decisions are now simple on/off switches, already built and tested: whether pending orders that traders placed earlier (for example "buy if the price drops to …") should also wait during an emergency pause, and during a restricted news window.
- Switch them on in the Firebase console by adding `holdPending: true` to the pause document (`engineControl/trading`) or the news calendar (`engineControl/news`). Left off, everything works exactly as today: waiting orders can still fill.
- When an order is held it stays in place and fills only after the pause or the news window ends, at the first real price after it (like after a weekend). Stop losses, take profits, loss limits and order expiry are never held, and traders can always cancel.
- In the terminal (https://www.fynxfunded.com/trade/access): held orders get a "Held" or "Held · news" tag in the Pending orders tab with a plain explanation, and the pause banner, order panel and each pair's Specification say whether waiting orders are held or can still fill.
- Ready for when the APIs are connected: exact steps in docs/ENGINE-READINESS.md ("Pause new trading" and "Restricted news windows").

## 2026-11-13 04:40 UTC — [autopilot] FYNX Trade: ready for "no new trades around big news" rules

- The trading server can now hold back new orders around high-impact economic releases (for example a US jobs report), pair by pair, if your account agreement says so. You keep the list of releases in one place in the Firebase console (`engineControl/news`); nothing is invented, and until you switch it on the list is shown to traders as information only.
- Inside a restricted window, new orders on the affected pairs (for a US release: EURUSD, USDJPY, GBPUSD…) are refused with a plain explanation; closing trades, cancelling orders and moving stop loss / take profit always keep working.
- In the terminal (https://www.fynxfunded.com/trade/access): a note in the order panel when a release is happening or due within the hour (in the trader's own time), a "News now / News soon" tag next to the pair in Market Watch, and a "Restricted news windows · next 7 days" list in each pair's Specification. Before trading is connected it says so honestly.
- Ready for when the APIs are connected: fill the calendar document and set `enforce: true` (exact steps in docs/ENGINE-READINESS.md, "Restricted news windows").

## 2026-11-13 00:45 UTC — [autopilot] Trading server: one emergency switch to pause new trading for everyone

- Added: an emergency "pause new trading" switch for the whole FYNX Trade server. If the broker or price provider has a problem, you flip one switch in the Firebase console (document engineControl/trading: paused = true, with an optional reason and end time) and within 10 seconds no trader can open or change an order. No redeploy, no account changes.
- During a pause traders can still close trades and cancel orders, and stops, targets and loss limits keep working. Anyone who tries to trade gets a plain message ("New trading is paused: … No order was sent; closing trades and cancelling orders still work.").
- The FYNX Trade terminal shows a yellow banner with your reason and the expected end time in the trader's own time, the order panel explains why it is locked, and the account's "Live on FYNX Trade" card on the dashboard says so too. Set paused = false (or delete the document) to resume; with an end time it resumes by itself.
- Safe by design: if the switch can't be read clearly it stays paused, and the readiness check (npm run engine:check) says whether the server starts paused.
- Where to see it: https://www.fynxfunded.com/trade/access and the account page in https://www.fynxfunded.com/dashboard once the trading server is connected; steps in docs/ENGINE-READINESS.md ("Pause new trading").

## 2026-11-12 20:30 UTC — [autopilot] Trading server: protection against password-guessing floods

- The FYNX Trade server can now protect itself when someone keeps trying to sign in with wrong or stolen sign-in details: after 30 failed attempts from the same network within 5 minutes, that network is paused for 15 minutes and is told so in plain words ("Too many failed sign-ins from this network…"). Traders on other networks are not affected, and getting out of trades from a normal session is never slowed by this.
- It switches on with one setting when you start the trading server (FYNX_ENGINE_CLIENT_ADDRESS=x-forwarded-for on Cloud Run); the readiness check (`npm run engine:check`) tells you whether it is on. Nothing changes on the live website until the trading server is connected.
- Where to see it: https://www.fynxfunded.com/trade/access (terminal) once the trading server is connected; switch-on steps in docs/ENGINE-READINESS.md.

## 2026-11-12 16:21 UTC — [autopilot] Trading server: protection against request floods; close-to-limit warning on the dashboard

- Added: the trading server now limits how many requests one signed-in trader can send in a short time (for example a stuck browser tab or a script sending hundreds of orders). Normal trading is never slowed: up to 20 orders or changes at once, then 2 per second; closing trades and cancelling orders get a much wider allowance (100 at once, 20 per second) so "Close all" and getting out always work. Anyone over the limit gets a plain message ("Too many orders or changes in a short time. Nothing was sent; try again in 1 second.") and nothing is recorded.
- The limits can be changed with one setting (FYNX_ENGINE_RATE_LIMITS) and are listed in the engine readiness check; refused requests are counted in the server's health line.
- Added: the "Live on FYNX Trade" card in the dashboard account page now shows today's close-to-a-loss-limit warning (how many dollars were left, the share of the allowance, the time and the equity), right above the lowest equity of the day. With no warning it says whether the warning is on and at which distance, or how to switch it on in FYNX Trade.
- See it at https://www.fynxfunded.com/dashboard/accounts (open a FYNX Trade account; figures appear once the trading server is connected).

## 2026-11-12 12:40 UTC — [autopilot] FYNX Trade: a warning before you reach a loss limit

- New choice in the terminal's Alerts tab: "Equity comes close to a loss limit". Pick how close (10%, 25% or 50% of the loss allowance still left) and the box tells you what that means in dollars on your account today, and how much room you have right now.
- When equity gets that close to the daily or the maximum loss limit, the trading server records a warning (at most once per limit per trading day), emails it once the email sender is connected, lists it in the Alerts tab and shows a pop-up if the terminal is open. A warning never opens or closes a trade.
- It is off until the trader switches it on (your decision whether it should be on by default).
- See it at https://www.fynxfunded.com/trade/access → Alerts tab (choices become active once the trading server is connected).

## 2026-11-12 08:40 UTC — [autopilot] FYNX Trade: lowest equity of each trading day

- Added: the trading server now remembers each account's lowest equity during the trading day (the worst moment, not only how the day ended), on live prices only. This is the figure that shows how close a trader really came to the daily loss limit.
- FYNX Trade terminal (https://www.fynxfunded.com/trade/access → Account): "Lowest equity today so far", with the time it happened and how much room was left above the loss limit at that moment. The daily statement has two new columns ("Lowest equity" and "Room at lowest"), the summary now shows the closest the account came to a limit during any day, and the CSV download has three new columns.
- FYNX Funded account page (https://www.fynxfunded.com/dashboard/accounts → an account): the live FYNX Trade card shows today's lowest equity too.
- Built to keep database costs low: the server checks every second but only saves a new low when it matters (a drop of 0.1% of the balance or more, at most once a minute for small dips). Older days recorded before today show "—" instead of a guess.
- Ready for switch-on: nothing extra to plug in; it works as soon as the trading server runs with the price provider.

## 2026-11-12 04:25 UTC — [autopilot] FYNX Trade: safe handling of missing prices after a restart

- Fixed: when the trading server had just restarted and did not yet have every price, an account holding a trade on a cross pair (for example EUR/JPY before the USD/JPY price arrived) could not be loaded at all, and a winning trade with no price yet could have made a healthy account look like it broke a loss limit. The server now waits for the missing price before checking the loss limits.
- FYNX Trade terminal (https://www.fynxfunded.com/trade/access): the account bar shows "Waiting…" for equity, free margin and room to the loss limit until every open trade has a price, with a line naming the pair; the order review explains that new orders wait a moment. Closing a trade that has a price still works.
- FYNX Funded account page (https://www.fynxfunded.com/dashboard): the "Live on FYNX Trade" card shows "Waiting for prices" instead of a number that would look real but leave a trade out.
- Ready for switch-on: nothing extra to plug in; it is part of the engine that starts with the price provider.

## 2026-11-12 00:30 UTC — [autopilot] FYNX Trade: a daily statement for every account

- Added: FYNX Trade now keeps a daily statement for each account, like a broker's end-of-day statement. When each trading day ends (22:00 UTC, the same moment the daily loss limit resets) the trading server writes down how the day ended: balance at the start and end, equity, trades closed and their result, the loss limit levels, how much room was left above them, what was held overnight and the overnight charge (swap). About three months are kept.
- In the terminal's Account tab (https://www.fynxfunded.com/trade/access → Account): "Daily statement" with up/down days, net change, best and worst day, the closest the account came to a limit at a day's end, one row per day, and "Download daily statement (CSV)".
- In the FYNX Funded account page (https://www.fynxfunded.com/dashboard/accounts → an account), the live FYNX Trade card shows the last 5 trading days.
- Honest by design: if a price was missing, equity is left blank instead of guessed; if the server was not running at the reset, the day is marked with * and explained. Before the first reset it says when the first record will appear.
- Ready for switch-on: nothing extra to plug in; this works as soon as the trading server runs.

## 2026-11-11 20:30 UTC — [autopilot] Trading engine: no trade lost after a restart; FYNX Trade page fixed on phones

- Fixed: on phones, the FYNX Trade home page could be dragged sideways (the page was almost twice as wide as the screen because of a hidden label in the "All pairs" table). It now fits the screen exactly: https://www.fynxfunded.com/trade
- Ready for switch-on: when the trading server restarts (Google restarts servers from time to time), any trade that closed just before the restart but had not reached the customer's dashboard yet is now written when the server comes back. Trades already on the dashboard are never written twice. By default it looks back 7 days; you can change that with one setting (`FYNX_ENGINE_LEDGER_CATCHUP_DAYS`).
- If the database is briefly unavailable, unsaved trade records are now tried again every 5 minutes until they are saved, instead of waiting for someone to notice.
- The server's log says after each start how many trades it checked, how many it had to add and how many were already there. The "ready to run?" check (`npm run engine:check`) lists the new setting. Details: docs/ENGINE-READINESS.md → "Run it (switch-on steps)". The dashboard page these trades appear on: https://www.fynxfunded.com/dashboard/trades

## 2026-11-11 16:35 UTC — [autopilot] Trading engine: the server program itself is finished and packaged

- Ready for switch-on: the trading server is no longer a recipe to assemble — it is a finished program. One command (`npm run engine:build`) produces a folder with the whole engine that can be uploaded to Google Cloud Run as it is. You add the settings (price provider, leverage, commission…) and start it; there is no code left to write.
- It protects itself: if any required setting is missing it refuses to start and lists exactly what is missing, so a half-set-up server never answers customers. Trading stays off unless you switch it on on the server AND on each account. Emails to traders stay off until you choose an email sender.
- It is easy to watch: it writes clear log lines (never your price key, sign-in tokens or customer emails), a health line every 5 minutes, and stops cleanly when Google restarts it, saving closed trades to the dashboard first.
- The exact steps, in order, are in docs/ENGINE-READINESS.md → "Run it (switch-on steps)". Nothing changes on the website today. The terminal it will power: https://www.fynxfunded.com/trade/access

## 2026-11-11 12:45 UTC — [autopilot] Trading engine: connect the price provider by filling in settings, and a "ready to run?" check

- Ready for switch-on: the price feed (the "gas") no longer needs any code for most providers. When you choose a price provider that streams prices over a WebSocket (most do), you fill in a few settings on the engine server (the provider's address, your key, and where the pair, bid and ask are in their messages) and it connects, names all 45 pairs the provider's way, refuses bad prices, and reconnects by itself if the provider drops or goes quiet. Your key is never shown in logs or reports.
- New one-command check for the engine server (`npm run engine:check`): it lists in plain words what is set and what is still missing (trading settings, price feed, Firebase access, the trading switch). Add `--feed 20` and it connects to your provider for 20 seconds and shows which pairs received prices, the latest bid/ask and spread, and why any message was refused, so a wrong setting is found before any customer sees it. It never places orders or changes any data.
- Nothing changes on the website today; trading stays off. The exact settings, with examples, are in docs/ENGINE-READINESS.md (step 1, "A licensed price feed"). The terminal it will power: https://www.fynxfunded.com/trade/access

## 2026-11-11 08:30 UTC — [autopilot] Trading engine knows your customers' accounts by itself; easier-to-read pages for everyone

- Ready for switch-on: the trading server can now find everything it needs about each customer's account on its own (which rules they bought, who owns it, whether it may trade, where to send their emails), straight from what checkout already saves. When you connect the price feed and start the server, there are no account lookups left to write. Trading still stays off until you switch it on in two places (the server's master switch and the account itself), and only for a paid challenge that is running; a passed phase waits for your review. The steps are in docs/ENGINE-READINESS.md ("Account directory").
- The trading server no longer reports customers who haven't opened the terminal yet as errors; it simply checks them later.
- Easier to read: the small grey risk warning and company note at the bottom of every page (https://www.fynxfunded.com) were too faint; they are now readable. The same for the light grey text on the FYNX Trade page (https://www.fynxfunded.com/trade), the filter counts on the FAQ and glossary (https://www.fynxfunded.com/faq), the "reset" label on the trading-day clock (https://www.fynxfunded.com/rules) and the 404 page.
- Screen readers: the login, sign-up and password pages (https://www.fynxfunded.com/login) and the challenge builder now announce a page title and main area; footer headings are in the right order; the FYNX Trade pair search no longer points at a list that isn't there; the pairs table's last column has a name.

## 2026-11-11 04:20 UTC — [autopilot] FYNX Trade: "one cancels the other" for pending orders

- Trading terminal (https://www.fynxfunded.com/trade/access), order ticket: pending orders (limit or stop) have a new "One cancels the other" choice. Link the new order with one you already placed, and when either of the two fills, the trading server cancels the other one straight away, also with the page closed. The usual use: a buy stop above and a sell stop below the price, so whichever way the market breaks opens the trade (the ticket names this a "breakout set-up", or a "range set-up" for two limits).
- The order review says which order it is linked with before you confirm.
- Pending orders tab: linked orders carry an "OCO" tag naming their partner; the order editor can link, change or remove the link of an order you already placed; a new "Cancelled by a linked order" list says which order was cancelled, when, and which fill caused it.
- Cancelling one of the two yourself, or its expiry, keeps the other pending on its own. The "order filled" email now also says which linked order was cancelled.
- Ready for switch-on: this is part of the trading server's order rules and its web contract (docs/ENGINE-READINESS.md), so it works the moment trading is connected.

## 2026-11-11 00:25 UTC — [autopilot] FYNX Trade: email notices when something happens on your account

- Trading terminal (https://www.fynxfunded.com/trade/access), Alerts tab: new "Email me when…" box. Tick what you want to hear about by email, also with the page closed: a price alert fires, a pending order is filled, a stop loss or take profit closes a trade, a loss limit is reached, the profit target is reached, a pending order expires. Your choices are saved with your account on the trading server.
- Each email says what happened in plain words, with the prices, the time (UTC) and a link back to the terminal. A loss-limit email says how many trades were closed and their result; a target email says clearly it is not yet the official result. The same email is never sent twice, and at most 30 an hour per account.
- Fixed: a new price alert on an account with no open trades could wait up to a minute before the server first checked it; it is now checked straight away.
- Until it is connected the box says so plainly: before trading is connected the choices can't be set, and before FYNX connects an email sender it says nothing is emailed yet.
- Ready for switch-on: plug in an email sender (the Firebase "Trigger Email" extension with the provider you choose) and every notice starts going out; the steps are in docs/ENGINE-READINESS.md.

## 2026-11-10 16:45 UTC — [autopilot] FYNX Trade: price alerts, and pair details from Market Watch

- New "Alerts" tab in the trading terminal (https://www.fynxfunded.com/trade/access), next to History. Pick a pair, choose "Bid at or above" or "Bid at or below", type the price and an optional note ("Retest of last week's high") and press Create alert. It shows the price now and how many pips away your level is, and if you typed a level on the wrong side of the price it offers a one-tap fix.
- The trading server watches your alerts for you, even with the page closed. Each alert fires once; fired alerts are listed with the time and the price that reached your level, and a pop-up appears if the terminal is open at that moment. Waiting alerts are listed closest-first, with a delete button. An alert only tells you: it never opens or closes a trade.
- Market Watch: every pair now has a small ⓘ button that opens its contract specification (contract, spread, leverage, margin, commission, swap and this week's trading hours) without changing the pair you are trading.
- Until trading is connected the Alerts tab says plainly that alerts start working then, and nothing is saved.
- Ready for switch-on: alerts are part of the trading engine and its connection contract (docs/ENGINE-READINESS.md); nothing else to plug in.

## 2026-11-10 12:30 UTC — [autopilot] FYNX Trade: contract specification per pair and the spread next to SELL/BUY

- New "Specification" button in the order panel of the trading terminal (https://www.fynxfunded.com/trade/access). It opens a clear sheet for the chosen pair: contract size, pip size, pip value per lot, the spread right now, leverage, smallest/largest volume, margin for one lot, commission, overnight swap (and which night is charged three times), and the trading hours for the next 7 days in your own time zone and in UTC, with any holiday or maintenance closures.
- Under the SELL and BUY buttons the terminal now shows the spread in pips and what it costs in dollars for the volume you entered.
- Until trading is connected the sheet says so honestly: no leverage, commission or spread is ever made up, and the hours shown are the standard forex week, labelled as such.
- Ready for switch-on: the trading server now publishes each pair's hours for the coming week (including closures you enter), and the terminal picks them up automatically.

## 2026-11-10 08:40 UTC — [autopilot] FYNX Trade: margin, commission and swap in the order panel

- Trading terminal (https://www.fynxfunded.com/trade/access), New order panel: new rows for Leverage (e.g. 1:30), Margin needed for the order, Free margin after, Commission for opening and closing, and Swap per night for a buy and a sell (with the day it counts three times). The figures come from the trading server's own settings and prices; until trading is connected each row says "Shown once trading is connected" instead of guessing.
- The order review now shows "Margin … · free margin after … · commission … round turn", and warns in plain words before you confirm an order the server would refuse (not enough free margin, or a volume outside the server's limits).
- History tab: how each trade closed is now written in plain words ("Closed by you", "Stop loss", "Take profit", "Daily loss limit") instead of codes like "manual".
- Ready for the API: the trading server now publishes each pair's leverage, lot limits, commission and swap with its status, and the terminal reads it safely. Nothing else to plug in (docs/ENGINE-READINESS.md updated).

## 2026-11-10 04:30 UTC — [autopilot] FYNX Trade: size a trade by risk, account statement download

- Trading terminal (https://www.fynxfunded.com/trade/access), New order panel: new "Size by risk" link under the volume. Type how much the stop loss may cost, as a share of the balance (or tap 0.25%, 0.5%, 1%) or in dollars. With the stop loss in pips it tells you the volume, for example "0.33 lots · a 15-pip stop would cost $49.50 of the $50.00 you chose", and "Use 0.33 lots" puts it in the volume box. It rounds down so you never risk more than you chose, and warns when the risk would use a large part of, or reach, what is left before your loss limit.
- Pairs not priced in US dollars (yen pairs, EURGBP, and so on) now get their pip value, risk and profit in dollars too, worked out from the trading server's own prices, once trading is connected. Until then they say so plainly instead of guessing.
- History tab: a summary of the closed trades shown (trades won and lost, win rate, gross profit and loss, commission, swap, profit factor, net result) and a "Download statement (CSV)" button with every trade and the totals, ready for a spreadsheet.
- Ready for the API: both work as soon as the trading server is connected; nothing else to plug in (docs/ENGINE-READINESS.md updated).

## 2026-11-10 00:30 UTC — [autopilot] FYNX Trade: price protection for market orders

- New "Price protection (pips)" box in the order panel of the trading terminal (https://www.fynxfunded.com/trade/access) for market orders. Type how far the price may move against you between pressing Confirm and the fill (or tap 0, 1 or 3). Empty means off, as before.
- The order review now shows the price right now and the worst price you would accept (for example "Price now 1.08010 (ask). Highest fill accepted: 1.08040").
- If the price moved further against you, the trading server opens nothing and says so in plain words ("The EURUSD price moved 1.3 pips against you … Nothing was opened."). A better price always fills.
- Ready for when the price feed and trading server are connected: the rule is enforced on the server, is part of the documented connection contract, and is covered by tests.

## 2026-11-09 20:35 UTC — [autopilot] FYNX Trade: waiting orders can expire on their own

- FYNX Trade terminal (https://www.fynxfunded.com/trade/access), New order panel: limit and stop orders now have an "Expiry" choice: "Good till cancelled", "End of today's trading day" (the 22:00 UTC daily reset) or a date and time in your own time zone. Under it, a plain sentence says exactly when the order would be cancelled and how long that is from now; a time in the past or more than a year away is flagged and the order can't be sent until it is fixed. The order review shows the expiry too.
- Pending orders tab: new "Expires" column with the time and a countdown (or "GTC"). The pencil editor can change the expiry or make the order good till cancelled again.
- Orders that reach their expiry without filling are cancelled by the trading server, even with the page closed, and listed under "Expired orders" with a note that nothing was bought or sold.
- Ready for the API: the trading engine and its connection contract handle expiry (checked on time alone, also while the market is closed, before any fill). docs/ENGINE-READINESS.md updated. Nothing is sent until the owner connects the trading server and switches trading on.

## 2026-11-09 16:40 UTC — [autopilot] FYNX Trade: change the trailing stop on a waiting order; cleaner certificate check

- FYNX Trade terminal (https://www.fynxfunded.com/trade/access), Pending orders tab → pencil: the order editor now has a "Trailing stop after the fill" field. You can add one to a waiting order, change the distance (15/30 pip shortcuts) or switch it off with "Trailing off". It tells you, in plain words, the price at which the trailing stop will start after the order fills, and says clearly when saving will switch off a trailing stop you set earlier. Before, the distance chosen when placing the order could not be changed without cancelling the order.
- The trading engine and its connection contract accept this change too, with the same limits as everywhere else (5 to 5,000 pips), so it works the moment the trading server is connected. The engine guide (docs/ENGINE-READINESS.md) is updated.
- Certificate check page (https://www.fynxfunded.com/certificates/verify): a verified certificate now lists only the details it actually records, instead of rows of "—". Learning certificates show the course name and quiz average instead of empty challenge rows.

## 2026-11-09 12:45 UTC — [autopilot] FYNX Trade: close several positions at once, trailing stop in the order ticket
- Positions tab (https://www.fynxfunded.com/trade/access): new "Close all", "Close winning" and "Close losing" buttons with how many positions each one closes. One confirmation shows which pairs and their combined result at today's prices; positions whose market is closed stay open and are named; afterwards a plain line says how many closed, the net result, and anything that could not be closed and why.
- New order ticket: optional "Trailing stop (pips)" with 15 / 30 shortcuts. It shows where the trailing stop would start for a buy and for a sell, appears in the order review, and blocks sending while the value is wrong. Market orders open with it; limit/stop orders keep it and apply it when they fill ("trail Np" tag on pending orders).
- Ready for the API: the trading engine and its server contract accept the trailing distance on new orders; docs/ENGINE-READINESS.md updated. Nothing is sent until the owner connects the trading server and switches trading on.

## 2026-11-09 08:40 UTC — [autopilot] FYNX Trade: trailing stop

- New in the trading terminal (https://www.fynxfunded.com/trade/access), Positions tab: open the pencil on a trade and type a "Trailing stop" distance in pips (or tap 10, 20 or 50 pips). Once the trade is that far in profit, the stop loss jumps to break-even and then follows the price at that distance; it never moves back. The trading server does this by itself, so it keeps working with the page closed.
- Before saving, the editor tells you in plain words where the trailing stop will start, or, if the trade is already far enough in profit, exactly where the stop will move to. Distances under 5 or over 5000 pips are explained and refused.
- Trades with a trailing stop show a small "trail 20p" tag next to their stop loss, and the "Live on FYNX Trade" card in the dashboard (https://www.fynxfunded.com/dashboard/accounts) says "(trailing 20 pips)".
- When a trailed stop is hit the trade closes as a stop loss; its risk and result in R in the journal still use the stop it opened with.
- Nothing is switched on: this works as soon as the price feed and trading server are connected (docs/ENGINE-READINESS.md).

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

## 2026-11-05 — FYNX Trade: account numbers in dollars, more markets, clearer access message, rules in the purchase email
- FYNX Trade (https://www.fynxfunded.com/trade/access) now shows each account's numbers in dollars: progress to the profit target with a bar, target balance, daily loss allowance, maximum loss floor and how much room is left above it. These come from the rules recorded with the purchase; the official status stays on the challenge page.
- A live countdown to the 22:00 UTC daily reset, in your own time, plus links to the trading-day clock and to the risk planner opened on your account size.
- Market watch now covers 20 markets in groups (forex majors and crosses, gold, silver, oil, US 500, US Tech 100, US 30, Germany 40, Bitcoin, Ether, Solana) with 5m / 15m / 1h / 4h / 1D buttons. Your last market and timeframe are remembered.
- When access is limited to private testing, the page now explains that in plain words (and that testers must sign in with email and password) instead of showing a red error with a code.
- The "Your FYNX Trade account access is ready" email sent after a purchase now lists the profit target, daily loss limit, maximum loss floor and minimum trading days in dollars. If any rule value looks wrong, the list is left out rather than shown incorrectly.

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
