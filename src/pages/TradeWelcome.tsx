import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity, ArrowRight, ArrowUpRight, Building2, Calculator, Check, ChevronDown, Clock, Gauge, Globe2, KeyRound, Layers, LineChart,
  Lock, Menu, Minus, Plus, Ruler, Search, ShieldCheck, Smartphone, Star, Timer, X, Zap,
} from "lucide-react";
import EcosystemSwitch from "@/components/EcosystemSwitch";
import { CONTRACT_SIZE, FOREX_PAIRS, forexMarketOpen, pairLabel, pairName, pipValueUsd, searchPairs, type ForexGroup } from "@/trade-access/instruments";
import { TRADING_CENTRES, centreStatus, formatMinutes } from "@/trade-access/sessions";
import { formatCountdown, tradingDayStatus } from "@/lib/tradingDayClock";

/**
 * Public home of FYNX Trade, the web trading platform (always dark, its own
 * brand). The terminal itself is at /trade/access. Nothing here shows a price
 * or a statistic that isn't real: market hours come from the visitor's clock,
 * figures come from the instrument catalogue.
 */
const TERMINAL_PATH = "/trade/access";
const PARTNER_MAIL = "mailto:support@fynxfunded.com?subject=FYNX%20Trade%20partnership";
const terminalFor = (symbol: string) => `${TERMINAL_PATH}?symbol=${symbol}`;

const nav = [["Platform", "#platform"], ["Engine", "#engine"], ["Markets", "#markets"], ["Partners", "#partners"], ["FAQ", "#faq"]] as const;
const label = "font-mono text-[11px] uppercase tracking-[.22em] text-amber-400";
const primary = "inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07090c]";
const ghost = "inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";
const panel = "rounded-2xl border border-white/[.08] bg-white/[.025]";

const faqs = [
  { q: "Can I place trades today?", a: "Not yet. The terminal and the trading engine are built; order placement switches on account by account when FYNX connects its price feed and opens trading. Until then no order is sent." },
  { q: "What can I trade on FYNX Trade?", a: `Forex: ${FOREX_PAIRS.filter(p => p.group === "Majors").length} major pairs, ${FOREX_PAIRS.filter(p => p.group === "Minors").length} minor (cross) pairs and ${FOREX_PAIRS.filter(p => p.group === "Exotics").length} exotic pairs. One 1.00 lot is 100,000 units of the first currency.` },
  { q: "Do I need to download anything?", a: "No. FYNX Trade runs in your web browser on computer, tablet and phone." },
  { q: "How do I sign in?", a: "With the same FYNX login (email and password, Google or Apple) you used to buy your account. Your account email links straight to it." },
  { q: "Is the money real?", a: "FYNX Funded evaluation and funded-stage accounts are simulated. Balances are virtual. Payout eligibility depends on your accepted agreement." },
  { q: "Where do the prices come from?", a: "Charts in the terminal come from TradingView for display. When trading opens, orders are filled by the FYNX engine at the bid/ask of FYNX's licensed price feed." },
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
  return <div className="min-h-screen bg-[#07090c] text-white antialiased selection:bg-amber-400/30" style={{ colorScheme: "dark" }}>
    <a href="#trade-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-amber-400 focus:px-4 focus:py-2 focus:text-sm focus:text-black">Skip to main content</a>

    {/* Header */}
    <header className="sticky top-0 z-50 border-b border-white/[.07] bg-[#07090c]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/trade" className="flex items-center gap-2.5" aria-label="FYNX Trade home">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 shadow-[0_0_24px_-4px_rgba(251,191,36,.6)]"><Activity size={17} strokeWidth={2.5} className="text-black" aria-hidden="true" /></span>
            <span className="text-[17px] font-semibold tracking-tight">FYNX <span className="font-normal text-white/55">Trade</span></span>
          </Link>
          <div className="[&_button]:border-white/15 [&_svg]:text-white/60"><EcosystemSwitch /></div>
        </div>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="FYNX Trade">
          {nav.map(([text, href]) => <a key={href} href={href} className="rounded-md px-3 py-2 text-sm text-white/65 transition hover:bg-white/5 hover:text-white">{text}</a>)}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Link to={`/login?next=${encodeURIComponent(TERMINAL_PATH)}`} className="rounded-lg px-4 py-2 text-sm text-white/80 hover:bg-white/5 hover:text-white">Log in</Link>
          <Link to={TERMINAL_PATH} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300">Trade now</Link>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <Link to={TERMINAL_PATH} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-black">Trade now</Link>
          <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={menu ? "Close menu" : "Open menu"} className="p-2 text-white/80">{menu ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
      {menu && <div className="border-t border-white/[.07] px-4 py-3 lg:hidden">
        {nav.map(([text, href]) => <a key={href} href={href} onClick={() => setMenu(false)} className="block border-b border-white/[.06] py-3 text-sm text-white/80">{text}</a>)}
        <div className="flex items-center gap-4 pt-3 text-sm"><Link to={`/login?next=${encodeURIComponent(TERMINAL_PATH)}`}>Log in</Link><Link to="/" className="ml-auto text-white/55">FYNX Funded</Link></div>
      </div>}
    </header>

    <main id="trade-main" tabIndex={-1} className="focus:outline-none">
      {/* Hero */}
      <section className="relative overflow-hidden" aria-labelledby="trade-hero-title">
        <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-48 left-1/2 h-[560px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(251,191,36,.16),transparent)]" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 lg:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3.5 py-1.5 text-xs text-white/75"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>Engine built · Trading opens soon</p>
            <h1 id="trade-hero-title" className="mt-7 text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-6xl lg:text-7xl">Trade the world&rsquo;s currencies <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-orange-400 bg-clip-text text-transparent">with precision.</span></h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">FYNX Trade is a web trading terminal for FYNX accounts. You get {FOREX_PAIRS.length} forex pairs, professional charts and an order panel that shows your risk in dollars before you click. It runs in the browser on desktop and phone.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3"><Link to={TERMINAL_PATH} className={primary}>Launch the terminal <ArrowRight size={16} /></Link><a href="#platform" className={ghost}>See how it works</a></div>
            <PairSearch />
          </div>
          <div className="relative mx-auto mt-16 max-w-6xl">
            <div className="pointer-events-none absolute -inset-x-10 -bottom-10 top-10 rounded-[2rem] bg-[radial-gradient(closest-side,rgba(251,191,36,.12),transparent)] blur-2xl" aria-hidden="true" />
            <TerminalShowcase />
          </div>
        </div>
      </section>

      <SessionBoard now={now} />

      {/* Facts */}
      <section aria-label="FYNX Trade at a glance" className="border-y border-white/[.07]">
        <dl className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4">
          {[[String(FOREX_PAIRS.length), "Forex pairs", "majors, minors and exotics"], ["0.01", "Lot minimum", "in 0.01 steps"], ["22:00", "UTC daily reset", "the day the loss limit uses"], ["0", "Downloads", "runs in the browser"]].map(([n, t, d], i) =>
            <div key={t} className={`px-6 py-9 ${i % 2 ? "border-l border-white/[.07]" : ""} ${i > 1 ? "border-t border-white/[.07] lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}><dt className="sr-only">{t}</dt><dd className="font-mono text-4xl font-medium tracking-tight sm:text-5xl">{n}</dd><dd className="mt-2 text-sm font-medium">{t}</dd><dd className="text-sm text-white/45">{d}</dd></div>)}
        </dl>
      </section>

      {/* Platform bento */}
      <section id="platform" className="scroll-mt-20" aria-labelledby="platform-title">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
          <div className="max-w-2xl"><p className={label}>The platform</p><h2 id="platform-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Everything on one screen. Nothing in your way.</h2><p className="mt-4 text-white/55">Market Watch on the left, the chart in the middle, the order panel on the right and your positions underneath. On a phone, the same tools sit in tabs at the bottom.</p></div>
          <div className="mt-14 grid gap-4 lg:grid-cols-6">
            <Bento className="lg:col-span-4" icon={Zap} title="One-tap order panel" text="Big SELL and BUY buttons with live bid and ask. Market, limit and stop orders. Volume from 0.01 lots, stop loss and take profit in pips, and a confirm step before anything is sent.">
              <div className="mt-6 grid max-w-md grid-cols-2 gap-2" aria-hidden="true"><div className="rounded-lg bg-red-600 py-3 text-center text-sm font-bold">SELL</div><div className="rounded-lg bg-blue-600 py-3 text-center text-sm font-bold">BUY</div><div className="col-span-2 flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 font-mono text-xs text-white/60"><span>Volume</span><span className="text-white">0.10 lots</span></div></div>
            </Bento>
            <Bento className="lg:col-span-2" icon={Gauge} title="Risk in dollars" text="Pip value, risk at your stop and profit at your target, before you trade. It also shows how much of today's loss allowance one stop would use.">
              <div className="mt-6 space-y-2 font-mono text-xs" aria-hidden="true"><Row k="0.10 lots · EUR/USD" v="$1.00 / pip" /><Row k="Stop 20 pips" v="$20.00 risk" /><Row k="Target 40 pips" v="2 : 1" /></div>
            </Bento>
            <Bento className="lg:col-span-2" icon={LineChart} title="Professional charts" text="TradingView charts with indicators and drawing tools, from one minute to one day." />
            <Bento className="lg:col-span-2" icon={Layers} title={`Market Watch, ${FOREX_PAIRS.length} pairs`} text="Search by symbol or currency name, filter majors, minors and exotics, and star the pairs you watch." />
            <Bento className="lg:col-span-2" icon={Smartphone} title="Built for the phone too" text="Quotes, Chart, Trade, History and Account tabs at the bottom, like a native trading app. Nothing to install." />
          </div>
        </div>
      </section>

      {/* Engine */}
      <section id="engine" className="scroll-mt-20 border-y border-white/[.07] bg-[linear-gradient(180deg,rgba(255,255,255,.02),transparent)]" aria-labelledby="engine-title">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:py-28">
          <div>
            <p className={label}>The FYNX engine</p>
            <h2 id="engine-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Every order checked. Every limit enforced.</h2>
            <p className="mt-5 max-w-md leading-relaxed text-white/55">FYNX Trade runs on FYNX&rsquo;s own trading engine. It fills orders at the bid and ask, values every position in dollars and watches your loss limits on every price update, not once a day.</p>
            <ul className="mt-8 space-y-3 text-sm">{["Orders refused before they can break a rule: wrong volume step, stop on the wrong side, not enough free margin or an old price", "Repeat clicks never open a second position", "Accounts are processed one command at a time, so two requests never collide"].map(t => <li key={t} className="flex gap-3 text-white/70"><Check size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />{t}</li>)}</ul>
          </div>
          <ol className={`${panel} divide-y divide-white/[.07]`}>
            {[
              [Zap, "Execution", "Market orders fill at the ask (buy) or bid (sell). Limit and stop orders trigger on price. Stop loss and take profit close automatically."],
              [ShieldCheck, "Risk limits", "The daily loss limit is measured from your balance at the 22:00 UTC reset, and the maximum loss is static. Touching either closes every position and locks the account."],
              [Calculator, "Accounting", "Profit in dollars for all 45 pairs, including yen and other non-dollar quotes, plus equity, margin, free margin and margin level. Money is calculated to the cent."],
              [Timer, "Trading days", "A new day starts at the reset. Days with trades are counted towards the minimum, and reaching the profit target is flagged for review."],
            ].map(([Icon, t, d], i) => { const I = Icon as typeof Zap; return <li key={t as string} className="flex gap-5 p-6"><span className="font-mono text-xs text-white/35">0{i + 1}</span><div><h3 className="flex items-center gap-2 font-semibold"><I size={16} className="text-amber-400" aria-hidden="true" />{t as string}</h3><p className="mt-1.5 text-sm leading-relaxed text-white/55">{d as string}</p></div></li>; })}
          </ol>
        </div>
      </section>

      <MarketsTable />

      {/* Tools + steps */}
      <section className="border-t border-white/[.07]" aria-labelledby="steps-title">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
          <p className={label}>Getting started</p>
          <h2 id="steps-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">From purchase to your first trade.</h2>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {[[KeyRound, "Get an account", "Choose a FYNX Funded challenge. When your purchase is confirmed, your FYNX Trade account is created."], [Clock, "Check your email", "We email a secure link to your new account. Sign in with your FYNX login: no extra app, no download."], [Activity, "Open FYNX Trade", "Pick a pair, set your volume, stop and target, and trade from the browser on any device."]].map(([Icon, t, d], i) => { const I = Icon as typeof Zap; return <li key={t as string} className={`${panel} p-7`}><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-lg bg-amber-400/10"><I size={18} className="text-amber-400" aria-hidden="true" /></span><span className="font-mono text-xs text-white/30">0{i + 1}</span></div><h3 className="mt-6 text-lg font-semibold">{t as string}</h3><p className="mt-2 text-sm leading-relaxed text-white/55">{d as string}</p></li>; })}
          </ol>
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[[Ruler, "Lot size calculator", "/rules#position-size"], [Gauge, "Risk planner", "/rules#risk-planner"], [Clock, "Trading-day clock", "/rules#trading-day"]].map(([Icon, t, to]) => { const I = Icon as typeof Zap; return <Link key={t as string} to={to as string} className="group flex items-center gap-3 rounded-xl border border-white/[.08] px-4 py-3.5 text-sm transition hover:border-white/20 hover:bg-white/[.03]"><I size={16} className="text-white/50" aria-hidden="true" /><span className="flex-1">{t as string}</span><ArrowUpRight size={15} className="text-white/40 transition group-hover:text-white" aria-hidden="true" /></Link>; })}
          </div>
        </div>
      </section>

      {/* Partners */}
      <section id="partners" className="scroll-mt-20" aria-labelledby="partners-title">
        <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:pb-28">
          <div className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-[radial-gradient(120%_120%_at_100%_0%,rgba(251,191,36,.14),transparent_55%),#0b0e13] p-8 sm:p-12">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
              <div>
                <p className={label}>For prop firms & brokers</p>
                <h2 id="partners-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em]">Put your traders on FYNX Trade.</h2>
                <p className="mt-4 max-w-md leading-relaxed text-white/60">FYNX Trade is built to host accounts from more than one business. We&rsquo;re talking to prop firms and brokers who want a modern web terminal and a rules engine for their clients.</p>
                <a href={PARTNER_MAIL} className={`${primary} mt-8`}>Talk to us about a partnership <ArrowRight size={15} /></a>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {[[Building2, "Prop firms", "Evaluations with daily loss, maximum loss and targets enforced by the engine and shown in dollars."], [Globe2, "Brokers", "A browser terminal on every device, connected through one documented API."], [Lock, "Accounts kept apart", "Each trader sees only the accounts bought under their own login."], [Star, "Your rules, your settings", "Leverage, commission and volume limits are configured per platform."]].map(([Icon, t, d]) => { const I = Icon as typeof Zap; return <li key={t as string} className="rounded-xl border border-white/[.08] bg-black/20 p-5"><I size={18} className="text-amber-400" aria-hidden="true" /><h3 className="mt-3 text-sm font-semibold">{t as string}</h3><p className="mt-1 text-sm leading-relaxed text-white/55">{d as string}</p></li>; })}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <Faq />

      {/* Final CTA */}
      <section className="relative overflow-hidden border-t border-white/[.07]" aria-labelledby="final-cta-title">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(closest-side,rgba(251,191,36,.14),transparent)]" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <h2 id="final-cta-title" className="text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">Your desk is ready.</h2>
          <p className="mt-4 text-white/55">Open the terminal, pick a pair and plan your next trade.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3"><Link to={TERMINAL_PATH} className={primary}>Launch the terminal <ArrowRight size={16} /></Link><Link to="/challenges" className={ghost}>Get an account</Link></div>
        </div>
      </section>
    </main>

    <footer className="border-t border-white/[.07] bg-[#05060a]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div><p className="flex items-center gap-2 font-semibold"><Activity size={16} className="text-amber-400" aria-hidden="true" />FYNX <span className="font-normal text-white/55">Trade</span></p><p className="mt-3 max-w-xs text-sm text-white/45">The web trading platform of the FYNX ecosystem.</p></div>
        {[
          ["Platform", [["Web terminal", TERMINAL_PATH], ["Engine", "#engine"], ["Markets", "#markets"], ["Partners", "#partners"]]],
          ["Tools", [["Lot size calculator", "/rules#position-size"], ["Risk planner", "/rules#risk-planner"], ["Trading-day clock", "/rules#trading-day"], ["Glossary", "/faq#glossary"]]],
          ["FYNX", [["FYNX Funded", "/"], ["Challenges", "/challenges"], ["FYNX Finance World", "https://www.fynxfinanceworld.com"], ["Support", "mailto:support@fynxfunded.com"]]],
          ["Legal", [["Terms of Service", "/terms"], ["Privacy Policy", "/privacy"], ["Risk Disclosure", "/risk-disclosure"], ["Refund Policy", "/refund-policy"]]],
        ].map(([head, links]) => <div key={head as string}><p className="text-xs font-semibold uppercase tracking-[.16em] text-white/80">{head as string}</p><ul className="mt-4 space-y-2.5 text-sm text-white/50">{(links as string[][]).map(([l, to]) => <li key={l}>{/^(#|https?:|mailto:)/.test(to) ? <a href={to} className="hover:text-white">{l}</a> : <Link to={to} className="hover:text-white">{l}</Link>}</li>)}</ul></div>)}
      </div>
      <div className="mx-auto max-w-7xl border-t border-white/[.06] px-4 py-6 text-xs leading-relaxed text-white/40 sm:px-6">
        <p>Trading foreign exchange carries a high level of risk and may not be suitable for everyone. FYNX Funded evaluation and funded-stage accounts are simulated and balances are virtual. Charts are supplied by TradingView for display only. Trading on FYNX Trade is not yet open.</p>
        <p className="mt-3">© {new Date().getFullYear()} FYNX. All rights reserved.</p>
      </div>
    </footer>
  </div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-white/[.08] bg-black/20 px-3 py-2"><span className="text-white/50">{k}</span><span>{v}</span></div>;
}

function Bento({ icon: Icon, title, text, className = "", children }: { icon: typeof Zap; title: string; text: string; className?: string; children?: React.ReactNode }) {
  return <div className={`${panel} p-7 ${className}`}><span className="grid h-10 w-10 place-items-center rounded-lg bg-amber-400/10"><Icon size={18} className="text-amber-400" aria-hidden="true" /></span><h3 className="mt-6 text-lg font-semibold">{title}</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">{text}</p>{children}</div>;
}

/** Live status of the four main forex centres, worked out from the visitor's clock. */
function SessionBoard({ now }: { now: Date | null }) {
  return <section aria-labelledby="sessions-title" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
    <div className={`${panel} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-5 py-4">
        <h2 id="sessions-title" className="flex items-center gap-2 text-sm font-semibold"><Globe2 size={16} className="text-amber-400" aria-hidden="true" />Global market hours</h2>
        <p className="font-mono text-xs text-white/50">{now ? <>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC · forex {forexMarketOpen(now) ? <span className="text-emerald-400">open</span> : "closed"} · daily reset in {formatCountdown(tradingDayStatus(now).msUntilReset)}</> : " "}</p>
      </div>
      <ul className="grid divide-white/[.07] sm:grid-cols-2 sm:divide-x lg:grid-cols-4" data-testid="session-strip">
        {TRADING_CENTRES.map(c => {
          const s = now ? centreStatus(c, now) : null;
          const progress = s?.open && s.minutesToChange !== null ? 1 - s.minutesToChange / ((c.closeHour - c.openHour) * 60) : 0;
          return <li key={c.id} className="border-t border-white/[.07] p-5 sm:[&:nth-child(-n+2)]:border-t-0 lg:border-t-0">
            <div className="flex items-center justify-between"><span className="font-medium">{c.city}</span><span className={`rounded-full px-2 py-0.5 text-[11px] ${s?.open ? "bg-emerald-400/10 text-emerald-400" : "bg-white/5 text-white/45"}`}>{s?.open ? "Open" : "Closed"}</span></div>
            <p className="mt-3 font-mono text-3xl tracking-tight">{s?.localTime ?? "--:--"}</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[.06]" aria-hidden="true"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="mt-2 text-xs text-white/45">{!s ? " " : s.open ? `Closes in ${formatMinutes(s.minutesToChange!)}` : s.minutesToChange !== null ? `Opens in ${formatMinutes(s.minutesToChange)}` : `Opens ${String(c.openHour).padStart(2, "0")}:00 local, next business day`}</p>
          </li>;
        })}
      </ul>
      <p className="border-t border-white/[.07] px-5 py-2.5 text-[11px] text-white/35">Usual local business hours, approximate. Brokers publish their own trading hours.</p>
    </div>
  </section>;
}

function PairSearch() {
  const [q, setQ] = useState(""), navigate = useNavigate();
  const results = q.trim() ? searchPairs(FOREX_PAIRS, q).slice(0, 6) : [];
  return <div className="mx-auto mt-10 max-w-xl text-left">
    <label htmlFor="pair-search" className="sr-only">Find a forex pair</label>
    <form className="relative flex items-center rounded-xl border border-white/10 bg-white/[.04] p-1.5 shadow-[0_8px_40px_-12px_rgba(0,0,0,.8)] backdrop-blur focus-within:border-amber-400/50" role="search" onSubmit={e => { e.preventDefault(); if (results[0]) navigate(terminalFor(results[0].symbol)); }}>
      <Search size={17} className="ml-3 text-white/40" aria-hidden="true" />
      <input id="pair-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a pair: EUR/USD, yen, GBP…" autoComplete="off" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35" aria-controls="pair-results" />
      <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90">Open</button>
      {results.length > 0 && <ul id="pair-results" className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] shadow-2xl">{results.map(p => <li key={p.symbol}><Link to={terminalFor(p.symbol)} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-white/5"><span className="font-mono font-semibold">{pairLabel(p)}</span><span className="truncate text-xs text-white/45">{pairName(p)}</span></Link></li>)}</ul>}
      {q.trim() && !results.length && <p className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-white/10 bg-[#0d1117] px-4 py-2.5 text-sm text-white/50">No pair matches “{q}”.</p>}
    </form>
    <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">{["EURUSD", "GBPUSD", "USDJPY", "GBPJPY", "AUDUSD"].map(s => <Link key={s} to={terminalFor(s)} className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-white/60 transition hover:border-amber-400/50 hover:text-white">{pairLabel(FOREX_PAIRS.find(p => p.symbol === s)!)}</Link>)}</p>
  </div>;
}

function MarketsTable() {
  const [group, setGroup] = useState<"All" | ForexGroup>("All"), [q, setQ] = useState(""), [all, setAll] = useState(false);
  const rows = useMemo(() => searchPairs(group === "All" ? FOREX_PAIRS : FOREX_PAIRS.filter(p => p.group === group), q), [group, q]);
  const shown = all || q.trim() ? rows : rows.slice(0, 12);
  const counts = (g: ForexGroup) => FOREX_PAIRS.filter(p => p.group === g).length;
  return <section id="markets" className="scroll-mt-20" aria-labelledby="markets-title">
    <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div><p className={label}>Markets</p><h2 id="markets-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">{FOREX_PAIRS.length} forex pairs, fully specified.</h2><p className="mt-3 max-w-xl text-sm text-white/50">Standard contract conventions. Spreads, leverage and fees are confirmed before trading opens.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Pair group">{(["All", "Majors", "Minors", "Exotics"] as const).map(g => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${group === g ? "bg-white text-black" : "text-white/60 hover:text-white"}`}>{g}{g !== "All" && <span className="ml-1 opacity-60">{counts(g)}</span>}</button>)}</div>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 px-3"><Search size={14} className="text-white/40" aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" aria-label="Filter pairs" className="w-28 bg-transparent py-2 text-xs text-white outline-none placeholder:text-white/35" /></label>
        </div>
      </div>
      <div className={`${panel} mt-10 overflow-x-auto`}>
        <table className="w-full min-w-[760px] text-sm" data-testid="markets-table">
          <thead><tr className="border-b border-white/[.08] text-left text-[11px] uppercase tracking-[.14em] text-white/40">{["Symbol", "Instrument", "Group", "Pip size", "Digits", "1 lot", "Pip value · 1 lot", ""].map(h => <th key={h} scope="col" className="px-5 py-3.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{shown.map(p => { const pv = pipValueUsd(p, 1); return <tr key={p.symbol} className="border-b border-white/[.05] transition last:border-0 hover:bg-white/[.03]">
            <th scope="row" className="px-5 py-3.5 text-left font-mono font-semibold">{pairLabel(p)}</th>
            <td className="px-5 py-3.5 text-white/55">{pairName(p)}</td>
            <td className="px-5 py-3.5"><span className={`rounded-full px-2 py-0.5 text-[11px] ${p.group === "Majors" ? "bg-amber-400/10 text-amber-300" : p.group === "Minors" ? "bg-sky-400/10 text-sky-300" : "bg-violet-400/10 text-violet-300"}`}>{p.group}</span></td>
            <td className="px-5 py-3.5 font-mono text-white/80">{p.pipSize}</td>
            <td className="px-5 py-3.5 font-mono text-white/80">{p.digits}</td>
            <td className="px-5 py-3.5 font-mono text-white/80">{CONTRACT_SIZE.toLocaleString()} {p.base}</td>
            <td className="px-5 py-3.5 font-mono">{pv !== null ? `$${pv.toFixed(2)}` : <span className="font-sans text-xs text-white/40">Moves with {p.quote}/USD</span>}</td>
            <td className="px-5 py-3.5 text-right"><Link to={terminalFor(p.symbol)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium transition hover:border-amber-400/60 hover:text-amber-300" aria-label={`Open ${pairLabel(p)} in the terminal`}>Trade <ArrowUpRight size={12} /></Link></td>
          </tr>; })}</tbody>
        </table>
        {!rows.length && <p className="px-5 py-6 text-sm text-white/50">No pair matches your filter.</p>}
      </div>
      {!q.trim() && rows.length > 12 && <button type="button" onClick={() => setAll(!all)} className={`${ghost} mt-6`}>{all ? "Show fewer" : `Show all ${rows.length} pairs`}<ChevronDown size={15} className={all ? "rotate-180" : ""} /></button>}
    </div>
  </section>;
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return <section id="faq" className="scroll-mt-20 border-t border-white/[.07]" aria-labelledby="trade-faq-title">
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_2fr] lg:py-28">
      <div><p className={label}>FAQ</p><h2 id="trade-faq-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em]">Questions, answered.</h2><p className="mt-3 text-sm text-white/50">Something else? <a href="mailto:support@fynxfunded.com" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">support@fynxfunded.com</a></p></div>
      <div className="space-y-2">
        {faqs.map((f, i) => <div key={f.q} className={`rounded-xl border transition ${open === i ? "border-white/15 bg-white/[.04]" : "border-white/[.08]"}`}>
          <h3><button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium">{f.q}<span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/5" aria-hidden="true">{open === i ? <Minus size={14} /> : <Plus size={14} />}</span></button></h3>
          {open === i && <p className="px-5 pb-5 text-sm leading-relaxed text-white/60">{f.a}</p>}
        </div>)}
      </div>
    </div>
  </section>;
}

/** Detailed drawing of the terminal (no prices: it is a picture, not a quote). */
function TerminalShowcase() {
  const candles = [[60, 40, 70, 30], [45, 52, 62, 38], [52, 44, 58, 36], [44, 58, 64, 40], [58, 66, 72, 52], [66, 60, 74, 54], [60, 72, 78, 56], [72, 80, 88, 68], [80, 74, 86, 66], [74, 86, 92, 70], [86, 82, 94, 76], [82, 96, 100, 78], [96, 90, 104, 86], [90, 104, 110, 86], [104, 98, 108, 92], [98, 110, 116, 94], [110, 106, 118, 100], [106, 118, 124, 102], [118, 112, 122, 106], [112, 124, 130, 110]];
  const y = (v: number) => 172 - v * 1.25;
  const watch = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "GBPJPY", "EURGBP", "EURJPY"];
  return <figure className="relative" aria-label="Illustration of the FYNX Trade terminal">
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e13] shadow-[0_40px_120px_-30px_rgba(0,0,0,.9)] ring-1 ring-white/[.04]">
      <div className="flex items-center gap-3 border-b border-white/[.07] px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /></div>
        <span className="text-xs font-semibold">FYNX <span className="font-normal text-white/45">Trade</span></span>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-400 sm:inline-flex"><span className="h-1 w-1 rounded-full bg-emerald-400" />Engine</span>
      </div>
      <div className="hidden grid-cols-6 gap-px border-b border-white/[.07] bg-white/[.05] text-[10px] sm:grid" aria-hidden="true">{["Balance", "Equity", "Floating P/L", "Margin", "Free margin", "Room to limit"].map(t => <div key={t} className="bg-[#0b0e13] px-3 py-2"><p className="uppercase tracking-wider text-white/35">{t}</p><div className="mt-1.5 h-2 w-16 rounded bg-white/10" /></div>)}</div>
      <div className="grid grid-cols-[112px_1fr] sm:grid-cols-[150px_1fr_190px]">
        <div className="border-r border-white/[.07] p-2.5">
          <p className="px-1.5 pb-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/35">Market Watch</p>
          {watch.map((s, i) => <div key={s} className={`flex items-center justify-between rounded-md px-1.5 py-[7px] font-mono text-[10px] ${i === 0 ? "bg-amber-400/10 text-amber-200" : "text-white/75"}`}><span className="font-semibold">{s}</span>{i < 3 && <Star size={9} className="fill-amber-400 text-amber-400" />}</div>)}
        </div>
        <div className="min-w-0 p-3 sm:p-4">
          <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">EUR/USD</p><p className="text-[10px] text-white/40">Euro / US Dollar</p></div><span className="flex gap-1">{["1m", "5m", "15m", "1H", "4H", "1D"].map((t, i) => <span key={t} className={`rounded px-1.5 py-0.5 text-[9px] ${i === 2 ? "bg-white text-black" : "text-white/45"}`}>{t}</span>)}</span></div>
          <svg viewBox="0 0 330 180" preserveAspectRatio="none" className="mt-3 h-44 w-full sm:h-56" aria-hidden="true">
            <defs><linearGradient id="tw-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="rgba(251,191,36,.18)" /><stop offset="1" stopColor="rgba(251,191,36,0)" /></linearGradient></defs>
            {[30, 70, 110, 150].map(g => <line key={g} x1="0" x2="330" y1={g} y2={g} stroke="rgba(255,255,255,.06)" strokeWidth="0.6" />)}
            <path d={`M10 ${y(50)} ${candles.map(([, c], i) => `L${10 + i * 16} ${y(c)}`).join(" ")} L314 180 L10 180 Z`} fill="url(#tw-area)" />
            {candles.map(([o, c, h, l], i) => { const x = 10 + i * 16, up = c >= o, col = up ? "#34d399" : "#f87171"; return <g key={i} fill={col} stroke={col}><line x1={x} x2={x} y1={y(h)} y2={y(l)} strokeWidth="1" /><rect x={x - 4.5} y={y(Math.max(o, c))} width="9" height={Math.max(2, Math.abs(c - o) * 1.25)} rx="1" /></g>; })}
          </svg>
          <div className="mt-2 hidden gap-4 border-t border-white/[.07] pt-2 text-[10px] text-white/40 sm:flex" aria-hidden="true">{["Positions", "Pending orders", "History", "Account"].map((t, i) => <span key={t} className={i === 0 ? "border-b border-amber-400 pb-1 text-white" : "pb-1"}>{t}</span>)}</div>
        </div>
        <div className="col-span-2 border-t border-white/[.07] p-3 sm:col-span-1 sm:border-l sm:border-t-0 sm:p-4">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-white/35">New order · EURUSD</p>
          <div className="mt-2.5 flex items-center justify-between rounded-md border border-white/10 px-2 py-1.5 font-mono text-xs"><Minus size={11} className="text-white/40" /><span className="font-semibold">0.10</span><Plus size={11} className="text-white/40" /></div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]"><div className="rounded-md border border-white/10 px-2 py-1.5 text-white/45">SL <span className="text-white">20</span> pips</div><div className="rounded-md border border-white/10 px-2 py-1.5 text-white/45">TP <span className="text-white">40</span> pips</div></div>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5"><span className="rounded-md bg-red-600 py-2.5 text-center text-[11px] font-bold">SELL</span><span className="rounded-md bg-blue-600 py-2.5 text-center text-[11px] font-bold">BUY</span></div>
          <div className="mt-3 space-y-1.5 text-[10px] text-white/45"><div className="flex justify-between"><span>Pip value</span><span className="text-white">$1.00</span></div><div className="flex justify-between"><span>Risk at stop</span><span className="text-white">$20.00</span></div><div className="flex justify-between"><span>Reward : risk</span><span className="text-white">2 : 1</span></div><div className="flex justify-between"><span>Daily allowance used</span><span className="text-white">4%</span></div></div>
        </div>
      </div>
    </div>
    <figcaption className="mt-4 text-center text-xs text-white/35">Illustration of the FYNX Trade terminal. Figures shown are worked examples for a $10,000 account, not prices.</figcaption>
  </figure>;
}
