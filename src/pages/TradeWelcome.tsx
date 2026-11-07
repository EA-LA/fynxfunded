import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, Building2, CandlestickChart, Globe2, ListOrdered, Lock, Menu, MonitorSmartphone, Plus, Minus,
  Search, Star, Target, Wallet, X, Zap, Bell,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import EcosystemSwitch from "@/components/EcosystemSwitch";
import { CONTRACT_SIZE, FOREX_PAIRS, forexMarketOpen, pairLabel, pairName, pipValueUsd, searchPairs, type ForexGroup } from "@/trade-access/instruments";
import { TRADING_CENTRES, centreStatus, formatMinutes } from "@/trade-access/sessions";
import { formatCountdown, tradingDayStatus } from "@/lib/tradingDayClock";

/** Public home of FYNX Trade, the web trading platform. The terminal itself is at /trade/access. */
const TERMINAL_PATH = "/trade/access";
const PARTNER_MAIL = "mailto:support@fynxfunded.com?subject=FYNX%20Trade%20partnership";
const terminalFor = (symbol: string) => `${TERMINAL_PATH}?symbol=${symbol}`;

const nav = [["Platform", "#platform"], ["Features", "#features"], ["Markets", "#markets"], ["Partners", "#partners"], ["FAQ", "#faq"]] as const;
const eyebrow = "text-[11px] font-semibold uppercase tracking-[.18em] text-emerald-700 dark:text-emerald-400";
const primary = "inline-flex items-center justify-center gap-2 bg-emerald-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const secondary = "inline-flex items-center justify-center gap-2 border border-border bg-background px-5 py-3 text-sm font-semibold transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const features = [
  { icon: ListOrdered, title: "Market Watch", text: `All ${FOREX_PAIRS.length} forex pairs. Search by symbol or currency, filter by group, star favourites.` },
  { icon: CandlestickChart, title: "Professional charts", text: "Live TradingView charts with indicators and drawing tools, 1 minute to 1 day." },
  { icon: Zap, title: "One-tap order panel", text: "SELL and BUY, market, limit and stop orders, from 0.01 lots, stop loss and take profit in pips." },
  { icon: Wallet, title: "Risk in dollars", text: "Pip value, the dollar risk at your stop and the profit at your target, before you trade." },
  { icon: Target, title: "Rules built in", text: "Profit target, daily loss limit and maximum loss shown in dollars, with the daily reset countdown." },
  { icon: MonitorSmartphone, title: "Browser and phone", text: "Nothing to install. The same terminal on desktop and phone, with an app-style bottom menu." },
];

const faqs = [
  { q: "Can I place trades today?", a: "Not yet. The terminal, prices and order panel are open to preview, and order placement switches on account by account when FYNX opens trading. Until then no order is sent." },
  { q: "What can I trade on FYNX Trade?", a: `Forex: ${FOREX_PAIRS.filter(p => p.group === "Majors").length} major pairs, ${FOREX_PAIRS.filter(p => p.group === "Minors").length} minor (cross) pairs and ${FOREX_PAIRS.filter(p => p.group === "Exotics").length} exotic pairs. One 1.00 lot is 100,000 units of the first currency.` },
  { q: "Do I need to download anything?", a: "No. FYNX Trade runs in your web browser on computer, tablet and phone." },
  { q: "How do I sign in?", a: "With the same FYNX login (email and password, Google or Apple) you used to buy your account. Your account email links straight to it." },
  { q: "Is the money real?", a: "FYNX Funded evaluation and funded-stage accounts are simulated. Balances are virtual. Payout eligibility depends on your accepted agreement." },
  { q: "Where do the prices come from?", a: "Charts and quotes are supplied by TradingView for display. When trading opens, the FYNX server sets the price each order is filled at." },
  { q: "Can my prop firm or brokerage use FYNX Trade?", a: "We're opening FYNX Trade to partner prop firms and brokers. Email us and tell us about your business." },
];

function useNow(ms = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = window.setInterval(() => setNow(new Date()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

export default function TradeWelcome() {
  const [menu, setMenu] = useState(false);
  const now = useNow();
  return <div className="min-h-screen bg-background text-foreground">
    <a href="#trade-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground">Skip to main content</a>

    {/* Utility bar */}
    <div className="bg-black text-[11px] text-white/70">
      <div className="mx-auto flex h-8 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <p className="truncate font-mono" data-testid="utc-clock">{now ? `${now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC` : " "}</p>
        <div className="flex items-center gap-4">
          <a href="https://www.fynxfinanceworld.com" className="hidden hover:text-white sm:inline">FYNX Finance World</a>
          <Link to="/" className="hidden hover:text-white sm:inline">FYNX Funded</Link>
          <a href="mailto:support@fynxfunded.com" className="hover:text-white">Support</a>
        </div>
      </div>
    </div>

    {/* Header */}
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/trade" className="leading-none" aria-label="FYNX Trade home"><span className="block text-2xl font-bold tracking-tight">FYNX</span><span className="block text-[9px] font-medium uppercase tracking-[.32em] text-muted-foreground">Trade platform</span></Link>
          <EcosystemSwitch />
        </div>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="FYNX Trade">
          {nav.map(([label, href]) => <a key={href} href={href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">{label}</a>)}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          <Link to={`/login?next=${encodeURIComponent(TERMINAL_PATH)}`} className="border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">Log in</Link>
          <Link to={TERMINAL_PATH} className="bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Trade now</Link>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <Link to={TERMINAL_PATH} className="bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Trade now</Link>
          <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={menu ? "Close menu" : "Open menu"} className="p-2">{menu ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
      {menu && <div className="border-t border-border bg-background px-4 py-3 lg:hidden">
        {nav.map(([label, href]) => <a key={href} href={href} onClick={() => setMenu(false)} className="block border-b border-border/60 py-3 text-sm font-medium">{label}</a>)}
        <div className="flex items-center gap-3 pt-3"><ThemeToggle /><Link to={`/login?next=${encodeURIComponent(TERMINAL_PATH)}`} className="text-sm font-medium">Log in</Link><Link to="/" className="ml-auto text-sm text-muted-foreground">FYNX Funded</Link></div>
      </div>}
      <SessionStrip now={now} />
    </header>

    <main id="trade-main" tabIndex={-1} className="focus:outline-none">
      {/* Hero */}
      <section className="border-b border-border" aria-labelledby="trade-hero-title">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.35fr_1fr] lg:gap-16 lg:py-20">
          <div>
            <p className={eyebrow}>The FYNX trading platform</p>
            <h1 id="trade-hero-title" className="mt-4 text-[2.75rem] font-bold leading-[1.02] tracking-[-0.035em] sm:text-6xl">Every forex pair.<br />One deliberate terminal.</h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">FYNX Trade is the web trading platform for FYNX accounts: quotes, professional charts and an order panel that shows your risk in dollars, on desktop and phone.</p>
            <PairSearch />
            <div className="mt-8 flex flex-wrap gap-3"><Link to={TERMINAL_PATH} className={primary}>Open the terminal <ArrowUpRight size={16} /></Link><Link to="/challenges" className={secondary}>Get an account</Link></div>
            <p className="mt-6 max-w-xl border-l-2 border-amber-500 pl-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Trading opens soon.</span> Preview the terminal now; order placement switches on per account.</p>
          </div>
          <div className="lg:border-l lg:border-border lg:pl-12">
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-muted-foreground">FYNX Trade</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">Start with what you need.</h2>
            <ol className="mt-5 border-t-2 border-foreground">
              {[
                ["Open the web terminal", "Market Watch, chart and order panel in your browser.", TERMINAL_PATH, false],
                ["Get a FYNX account", "Choose a challenge; your FYNX Trade account follows the purchase.", "/challenges", false],
                ["Size your next trade", "Lots from your risk and stop distance, for any pair.", "/rules#position-size", false],
                ["Partner with FYNX Trade", "For prop firms and brokers who need a web terminal.", PARTNER_MAIL, true],
              ].map(([title, text, to, mail], i) => {
                const body = <><span className="font-mono text-xs text-muted-foreground">0{i + 1}</span><span className="min-w-0 flex-1"><span className="block font-semibold group-hover:underline">{title as string}</span><span className="mt-1 block text-sm text-muted-foreground">{text as string}</span></span><ArrowUpRight size={15} className="mt-0.5 shrink-0 text-muted-foreground transition group-hover:text-foreground" aria-hidden="true" /></>;
                return <li key={title as string} className="border-b border-border">{mail ? <a href={to as string} className="group flex gap-5 py-5">{body}</a> : <Link to={to as string} className="group flex gap-5 py-5">{body}</Link>}</li>;
              })}
            </ol>
          </div>
        </div>
      </section>

      {/* Dark band: the terminal */}
      <section id="platform" className="scroll-mt-28 bg-[#0b100d] text-white" aria-labelledby="platform-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.25fr] lg:py-24">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-emerald-400">The terminal</p>
            <h2 id="platform-title" className="mt-4 text-4xl font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl">Quotes, chart, orders.<br /> One screen.</h2>
            <p className="mt-5 max-w-md leading-relaxed text-white/65">The layout traders already know: quotes on the left, the chart in the middle, the order panel on the right and your positions underneath. On a phone: Quotes, Chart, Trade, History and Account tabs.</p>
            <Link to={TERMINAL_PATH} className="mt-8 inline-flex items-center gap-3 bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90">Explore the terminal <ArrowUpRight size={15} /></Link>
            <ol className="mt-10 flex flex-wrap gap-x-8 gap-y-2 border-t border-white/15 pt-5 font-mono text-xs text-white/60">{["Watch", "Plan", "Execute", "Review"].map((s, i) => <li key={s}><span className="mr-2 text-white/35">0{i + 1}</span>{s}</li>)}</ol>
          </div>
          <TerminalPreview />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-28 border-b border-border" aria-labelledby="features-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className={eyebrow}>Precision, without the friction</p><h2 id="features-title" className="mt-3 text-4xl font-bold leading-[1.05] tracking-[-0.03em]">Built for traders<br />who manage risk first.</h2></div><Link to={TERMINAL_PATH} className="inline-flex items-center gap-2 text-sm font-semibold hover:underline">Open the terminal <ArrowUpRight size={15} /></Link></div>
          <ul className="mt-10 grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }, i) => <li key={title} className="border-b border-r border-border p-6"><div className="flex items-start justify-between"><Icon size={20} className="text-emerald-700 dark:text-emerald-400" aria-hidden="true" /><span className="font-mono text-[11px] text-muted-foreground">0{i + 1}</span></div><h3 className="mt-6 text-lg font-semibold tracking-tight">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p></li>)}
          </ul>
        </div>
      </section>

      <MarketsTable />

      {/* How it works */}
      <section className="border-b border-border" aria-labelledby="steps-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <p className={eyebrow}>How it works</p>
          <h2 id="steps-title" className="mt-3 text-4xl font-bold tracking-[-0.03em]">From purchase to your first trade.</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              ["Get an account", "Choose a FYNX Funded challenge. When your purchase is confirmed, your FYNX Trade account is created."],
              ["Check your email", "We email a secure link to your new account. Sign in with your FYNX login: no extra app, no download."],
              ["Open FYNX Trade", "Pick a pair, set your volume, stop and target, and trade from the browser on any device."],
            ].map(([t, d], i) => <li key={t} className="border-t-2 border-foreground pt-5"><span className="font-mono text-xs text-muted-foreground">Step 0{i + 1}</span><h3 className="mt-2 text-xl font-semibold tracking-tight">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</p></li>)}
          </ol>
        </div>
      </section>

      {/* Partners */}
      <section id="partners" className="scroll-mt-28 border-b border-border bg-secondary/30" aria-labelledby="partners-title">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:py-20">
          <div>
            <p className={eyebrow}>For prop firms & brokers</p>
            <h2 id="partners-title" className="mt-3 text-4xl font-bold leading-[1.05] tracking-[-0.03em]">Put your traders on FYNX Trade.</h2>
            <p className="mt-5 max-w-md leading-relaxed text-muted-foreground">FYNX Trade is built to host accounts from more than one business. We're talking to prop firms and brokers who want a modern web terminal for their clients.</p>
            <a href={PARTNER_MAIL} className={`${primary} mt-8`}>Talk to us about a partnership <ArrowRight size={15} /></a>
          </div>
          <ul className="grid border-l border-t border-border bg-background sm:grid-cols-2">
            {[
              { icon: Building2, title: "Prop firms", text: "Run evaluations with the daily loss, maximum loss and profit target shown to the trader in dollars." },
              { icon: Globe2, title: "Brokers", text: "Offer a browser terminal that works on every device, under one login for your clients." },
              { icon: Lock, title: "Accounts kept apart", text: "Each trader sees only the accounts bought under their own login." },
              { icon: Bell, title: "Account emails", text: "Customers get an email with a secure link as soon as their account is created." },
            ].map(({ icon: Icon, title, text }) => <li key={title} className="border-b border-r border-border p-6"><Icon size={20} className="text-emerald-700 dark:text-emerald-400" aria-hidden="true" /><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p></li>)}
          </ul>
        </div>
      </section>

      <Faq />
    </main>

    <footer className="bg-[#0b100d] text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        {[
          ["Platform", [["Web terminal", TERMINAL_PATH], ["Features", "#features"], ["Markets", "#markets"], ["Partners", "#partners"]]],
          ["Trading tools", [["Lot size calculator", "/rules#position-size"], ["Risk planner", "/rules#risk-planner"], ["Trading-day clock", "/rules#trading-day"], ["Glossary", "/faq#glossary"]]],
          ["FYNX", [["FYNX Funded", "/"], ["Challenges", "/challenges"], ["FYNX Finance World", "https://www.fynxfinanceworld.com"], ["Support", "mailto:support@fynxfunded.com"]]],
          ["Legal", [["Terms of Service", "/terms"], ["Privacy Policy", "/privacy"], ["Risk Disclosure", "/risk-disclosure"], ["Refund Policy", "/refund-policy"]]],
        ].map(([head, links]) => <div key={head as string}><p className="text-[11px] font-semibold uppercase tracking-[.14em]">{head as string}</p><ul className="mt-4 space-y-2.5 text-sm text-white/65">{(links as string[][]).map(([l, to]) => <li key={l}>{/^(#|https?:|mailto:)/.test(to) ? <a href={to} className="hover:text-white">{l}</a> : <Link to={to} className="hover:text-white">{l}</Link>}</li>)}</ul></div>)}
      </div>
      <div className="mx-auto max-w-7xl border-t border-white/10 px-4 py-6 text-xs leading-relaxed text-white/50 sm:px-6">
        <p>Trading foreign exchange carries a high level of risk and may not be suitable for everyone. FYNX Funded evaluation and funded-stage accounts are simulated and balances are virtual. Charts and quotes are supplied by TradingView for display only. Trading on FYNX Trade is not yet open.</p>
        <p className="mt-3">© {new Date().getFullYear()} FYNX. All rights reserved.</p>
      </div>
    </footer>
  </div>;
}

/** Live status of the four main forex centres, worked out from the visitor's clock. */
function SessionStrip({ now }: { now: Date | null }) {
  if (!now) return <div className="h-10 border-t border-border" aria-hidden="true" />;
  const week = forexMarketOpen(now), day = tradingDayStatus(now);
  return <div className="border-t border-border bg-secondary/30" aria-label="Forex market sessions" role="region">
    <ul className="mx-auto flex max-w-7xl overflow-x-auto text-xs" data-testid="session-strip">
      <li className="flex shrink-0 items-center gap-2 border-r border-border px-4 py-2.5"><span className={`h-1.5 w-1.5 rounded-full ${week ? "bg-emerald-500" : "bg-muted-foreground"}`} /><span className="font-semibold">Forex {week ? "open" : "closed"}</span><span className="font-mono text-muted-foreground">reset {formatCountdown(day.msUntilReset)}</span></li>
      {TRADING_CENTRES.map(c => { const s = centreStatus(c, now); return <li key={c.id} className="flex shrink-0 items-center gap-2 border-r border-border px-4 py-2.5"><span className={`h-1.5 w-1.5 rounded-full ${s.open ? "bg-emerald-500" : "bg-muted-foreground/50"}`} /><span className="font-semibold">{c.city}</span><span className="font-mono text-muted-foreground">{s.localTime}</span><span className={s.open ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{s.open ? `Open · closes in ${formatMinutes(s.minutesToChange!)}` : s.minutesToChange !== null ? `Opens in ${formatMinutes(s.minutesToChange)}` : "Closed"}</span></li>; })}
      <li className="flex shrink-0 items-center px-4 py-2.5 text-[11px] text-muted-foreground">Usual local business hours · approximate</li>
    </ul>
  </div>;
}

function PairSearch() {
  const [q, setQ] = useState(""), navigate = useNavigate();
  const results = q.trim() ? searchPairs(FOREX_PAIRS, q).slice(0, 6) : [];
  return <div className="mt-8 max-w-xl">
    <label htmlFor="pair-search" className="text-[11px] font-semibold uppercase tracking-[.16em]">Find a forex pair</label>
    <form className="relative mt-2 flex border border-border bg-background" role="search" onSubmit={e => { e.preventDefault(); if (results[0]) navigate(terminalFor(results[0].symbol)); }}>
      <Search size={17} className="ml-4 self-center text-muted-foreground" aria-hidden="true" />
      <input id="pair-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Try EUR/USD, yen, GBP…" autoComplete="off" className="min-w-0 flex-1 bg-transparent px-3 py-3.5 text-sm outline-none" aria-controls="pair-results" />
      <button type="submit" className="m-1 bg-emerald-900 px-5 text-sm font-semibold text-white hover:bg-emerald-800">Open</button>
      {results.length > 0 && <ul id="pair-results" className="absolute inset-x-0 top-full z-20 mt-1 border border-border bg-popover shadow-lg">{results.map(p => <li key={p.symbol}><Link to={terminalFor(p.symbol)} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-secondary"><span className="font-mono font-semibold">{pairLabel(p)}</span><span className="truncate text-xs text-muted-foreground">{pairName(p)}</span></Link></li>)}</ul>}
      {q.trim() && !results.length && <p className="absolute inset-x-0 top-full z-20 mt-1 border border-border bg-popover px-4 py-2.5 text-sm text-muted-foreground">No pair matches “{q}”.</p>}
    </form>
    <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Popular</span>{["EURUSD", "GBPUSD", "USDJPY", "GBPJPY"].map(s => <Link key={s} to={terminalFor(s)} className="underline decoration-border underline-offset-4 hover:decoration-foreground">{pairLabel(FOREX_PAIRS.find(p => p.symbol === s)!)}</Link>)}</p>
  </div>;
}

function MarketsTable() {
  const [group, setGroup] = useState<"All" | ForexGroup>("All"), [q, setQ] = useState(""), [all, setAll] = useState(false);
  const rows = useMemo(() => searchPairs(group === "All" ? FOREX_PAIRS : FOREX_PAIRS.filter(p => p.group === group), q), [group, q]);
  const shown = all || q.trim() ? rows : rows.slice(0, 12);
  const counts = (g: ForexGroup) => FOREX_PAIRS.filter(p => p.group === g).length;
  return <section id="markets" className="scroll-mt-28 border-b border-border" aria-labelledby="markets-title">
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><p className={eyebrow}>Markets</p><h2 id="markets-title" className="mt-3 text-4xl font-bold tracking-[-0.03em]">{FOREX_PAIRS.length} forex pairs, specified.</h2><p className="mt-3 max-w-xl text-sm text-muted-foreground">Standard contract conventions. Spreads, leverage and fees are confirmed with the broker before trading opens.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-border" role="group" aria-label="Pair group">{(["All", "Majors", "Minors", "Exotics"] as const).map(g => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`px-3 py-2 text-xs font-medium ${group === g ? "bg-foreground text-background" : "hover:bg-secondary"}`}>{g}{g !== "All" && <span className="ml-1 opacity-60">{counts(g)}</span>}</button>)}</div>
          <label className="flex items-center gap-2 border border-border px-3"><Search size={14} className="text-muted-foreground" aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" aria-label="Filter pairs" className="w-28 bg-transparent py-2 text-xs outline-none" /></label>
        </div>
      </div>
      <div className="mt-8 overflow-x-auto border-t-2 border-foreground">
        <table className="w-full min-w-[720px] text-sm" data-testid="markets-table">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[.12em] text-muted-foreground">{["Symbol", "Instrument", "Group", "Pip size", "Digits", "1 lot", "Pip value · 1 lot", ""].map(h => <th key={h} scope="col" className="py-3 pr-4 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{shown.map(p => { const pv = pipValueUsd(p, 1); return <tr key={p.symbol} className="border-b border-border/70 hover:bg-secondary/40">
            <th scope="row" className="py-3 pr-4 text-left font-mono font-semibold">{pairLabel(p)}</th>
            <td className="py-3 pr-4 text-muted-foreground">{pairName(p)}</td>
            <td className="py-3 pr-4"><span className="border border-border px-1.5 py-0.5 text-[11px]">{p.group}</span></td>
            <td className="py-3 pr-4 font-mono">{p.pipSize}</td>
            <td className="py-3 pr-4 font-mono">{p.digits}</td>
            <td className="py-3 pr-4 font-mono">{CONTRACT_SIZE.toLocaleString()} {p.base}</td>
            <td className="py-3 pr-4 font-mono">{pv !== null ? `$${pv.toFixed(2)}` : <span className="font-sans text-xs text-muted-foreground">Moves with {p.quote}/USD</span>}</td>
            <td className="py-3 text-right"><Link to={terminalFor(p.symbol)} className="inline-flex items-center gap-1 text-xs font-semibold hover:underline" aria-label={`Open ${pairLabel(p)} in the terminal`}>Trade <ArrowUpRight size={13} /></Link></td>
          </tr>; })}</tbody>
        </table>
        {!rows.length && <p className="py-6 text-sm text-muted-foreground">No pair matches your filter.</p>}
      </div>
      {!q.trim() && rows.length > 12 && <button type="button" onClick={() => setAll(!all)} className={`${secondary} mt-6`}>{all ? "Show fewer" : `Show all ${rows.length} pairs`}</button>}
    </div>
  </section>;
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return <section id="faq" className="scroll-mt-28" aria-labelledby="trade-faq-title">
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_2fr] lg:py-20">
      <div><h2 id="trade-faq-title" className="text-4xl font-bold tracking-[-0.03em]">FAQs</h2><p className="mt-3 text-sm text-muted-foreground">More questions? <a href="mailto:support@fynxfunded.com" className="underline underline-offset-4">support@fynxfunded.com</a></p></div>
      <div className="space-y-3">
        {faqs.map((f, i) => <div key={f.q} className="rounded-3xl border border-border bg-background shadow-sm">
          <h3><button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left font-semibold">{f.q}<span className="grid h-7 w-7 shrink-0 place-items-center bg-secondary" aria-hidden="true">{open === i ? <Minus size={14} /> : <Plus size={14} />}</span></button></h3>
          {open === i && <p className="px-6 pb-5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>}
        </div>)}
      </div>
    </div>
  </section>;
}

/** Drawn illustration of the terminal (no prices: it is a picture, not a quote). */
function TerminalPreview() {
  const candles = [[60, 40, 70, 30], [45, 52, 62, 38], [52, 44, 58, 36], [44, 58, 64, 40], [58, 66, 72, 52], [66, 60, 74, 54], [60, 72, 78, 56], [72, 80, 88, 68], [80, 74, 86, 66], [74, 86, 92, 70], [86, 82, 94, 76], [82, 96, 100, 78], [96, 90, 104, 86], [90, 104, 110, 86]];
  const y = (v: number) => 150 - v * 1.2;
  return <figure aria-label="Illustration of the FYNX Trade terminal">
    <div className="overflow-hidden border border-white/15 bg-[#11171a] text-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-[11px] text-white/60"><span className="font-semibold text-white">FYNX <span className="font-normal text-white/50">Trade</span></span><span className="font-mono">Web terminal</span></div>
      <div className="grid grid-cols-[104px_1fr] sm:grid-cols-[124px_1fr_148px]">
        <div className="border-r border-white/10 p-2">
          <p className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wider text-white/45">Market Watch</p>
          {["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "GBPJPY", "EURGBP"].map((s, i) => <div key={s} className={`flex items-center justify-between px-1.5 py-1.5 font-mono text-[10px] ${i === 0 ? "bg-white/10" : ""}`}><span className="font-semibold">{s}</span>{i < 3 && <Star size={9} className="fill-amber-400 text-amber-400" />}</div>)}
        </div>
        <div className="p-3">
          <div className="flex items-center justify-between"><span className="text-sm font-semibold">EUR/USD</span><span className="flex gap-1">{["5m", "15m", "1H"].map((t, i) => <span key={t} className={`px-1.5 py-0.5 text-[9px] ${i === 1 ? "bg-white text-black" : "text-white/50"}`}>{t}</span>)}</span></div>
          <svg viewBox="0 0 230 160" className="mt-2 h-40 w-full" aria-hidden="true">
            {[30, 70, 110, 150].map(g => <line key={g} x1="0" x2="230" y1={g} y2={g} stroke="rgba(255,255,255,.08)" strokeWidth="0.5" />)}
            {candles.map(([o, c, h, l], i) => { const x = 10 + i * 15.5, up = c >= o, col = up ? "#10b981" : "#ef4444"; return <g key={i} fill={col} stroke={col}><line x1={x} x2={x} y1={y(h)} y2={y(l)} strokeWidth="1" /><rect x={x - 4} y={y(Math.max(o, c))} width="8" height={Math.max(2, Math.abs(c - o) * 1.2)} /></g>; })}
          </svg>
        </div>
        <div className="col-span-2 border-t border-white/10 p-3 sm:col-span-1 sm:border-l sm:border-t-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-white/45">New order</p>
          <div className="mt-2 border border-white/15 py-1.5 text-center font-mono text-xs font-semibold">0.10 lots</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5"><span className="bg-red-600 py-2 text-center text-[11px] font-bold">SELL</span><span className="bg-blue-600 py-2 text-center text-[11px] font-bold">BUY</span></div>
          <div className="mt-2 space-y-1 text-[9px] text-white/55"><div className="flex justify-between"><span>Stop loss</span><span>20 pips</span></div><div className="flex justify-between"><span>Risk</span><span className="text-white">$20.00</span></div><div className="flex justify-between"><span>Reward : risk</span><span>2 : 1</span></div></div>
        </div>
      </div>
    </div>
    <figcaption className="mt-3 text-xs text-white/45">Illustration of the FYNX Trade terminal.</figcaption>
  </figure>;
}
