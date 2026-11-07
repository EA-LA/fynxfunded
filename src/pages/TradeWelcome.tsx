import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Bell, Building2, CandlestickChart, Check, ChevronDown, Globe2, Handshake, LayoutGrid, LineChart, ListOrdered,
  Lock, Mail, Menu, MonitorSmartphone, ShieldCheck, Smartphone, Star, Target, Wallet, X, Zap,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import EcosystemSwitch from "@/components/EcosystemSwitch";
import { FOREX_PAIRS, pairLabel } from "@/trade-access/instruments";

/** Public home of FYNX Trade, the web trading platform. The terminal itself is at /trade/access. */
const TERMINAL_PATH = "/trade/access";
const PARTNER_MAIL = "mailto:support@fynxfunded.com?subject=FYNX%20Trade%20partnership";

const nav = [["Platform", "#platform"], ["Features", "#features"], ["Markets", "#markets"], ["For firms & brokers", "#partners"], ["FAQ", "#faq"]] as const;

const features = [
  { icon: ListOrdered, title: "Market Watch", text: `All ${FOREX_PAIRS.length} forex pairs in one list: majors, minors and exotics. Search by symbol or currency name and star your favourites.` },
  { icon: CandlestickChart, title: "Professional charts", text: "Live TradingView charts with candles, indicators and drawing tools, from one-minute to daily timeframes." },
  { icon: Zap, title: "One-tap order panel", text: "Big SELL and BUY buttons, market, limit and stop orders, volume from 0.01 lots, stop loss and take profit in pips." },
  { icon: Wallet, title: "Risk in dollars", text: "See the pip value, the dollar risk at your stop and the profit at your target before you trade, not after." },
  { icon: Target, title: "Challenge rules built in", text: "Your profit target, daily loss limit and maximum loss shown in dollars, with a countdown to the daily reset." },
  { icon: MonitorSmartphone, title: "Browser and phone", text: "Nothing to download or install. The same terminal on desktop, tablet and phone, with a bottom menu made for one hand." },
];

const steps = [
  { title: "Get an account", text: "Choose a FYNX Funded challenge. When your purchase is confirmed, your FYNX Trade account is created." },
  { title: "Check your email", text: "We email you a secure link to your new account. You sign in with your FYNX login: no extra app, no download." },
  { title: "Open FYNX Trade", text: "Pick a pair, set your volume, stop and target, and trade from the browser on any device." },
];

const faqs = [
  { q: "Can I place trades today?", a: "Not yet. The terminal, prices and order panel are open to preview, and order placement switches on account by account when FYNX opens trading. Until then no order is sent." },
  { q: "What can I trade on FYNX Trade?", a: `Forex: ${FOREX_PAIRS.filter(p => p.group === "Majors").length} major pairs, ${FOREX_PAIRS.filter(p => p.group === "Minors").length} minor (cross) pairs and ${FOREX_PAIRS.filter(p => p.group === "Exotics").length} exotic pairs. Contract size is 100,000 units of the first currency per 1.00 lot.` },
  { q: "Do I need to download anything?", a: "No. FYNX Trade runs in your web browser on computer, tablet and phone." },
  { q: "How do I sign in?", a: "With the same FYNX login (email and password, Google or Apple) you used to buy your account. Your account email links straight to it." },
  { q: "Is the money real?", a: "FYNX Funded evaluation and funded-stage accounts are simulated. Balances are virtual. Payout eligibility depends on your accepted agreement." },
  { q: "Where do the prices come from?", a: "Charts and quotes are supplied by TradingView for display. When trading opens, the FYNX server sets the price each order is filled at." },
  { q: "Can my prop firm or brokerage use FYNX Trade?", a: "We're opening FYNX Trade to partner prop firms and brokers. Email us and tell us about your business." },
];

export default function TradeWelcome() {
  const [menu, setMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const groups = (["Majors", "Minors", "Exotics"] as const).map(g => [g, FOREX_PAIRS.filter(p => p.group === g)] as const);
  const cta = "inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const ghost = "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-6 py-3.5 text-sm font-semibold transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return <div className="min-h-screen bg-background text-foreground">
    <a href="#trade-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground">Skip to main content</a>
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Link to="/trade" className="flex items-center gap-2 text-xl font-bold tracking-tight"><span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm text-white">F</span>FYNX<span className="-ml-1 font-light text-muted-foreground">Trade</span></Link>
          <EcosystemSwitch />
        </div>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="FYNX Trade">
          {nav.map(([label, href]) => <a key={href} href={href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">{label}</a>)}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          <Link to={`/login?next=${encodeURIComponent(TERMINAL_PATH)}`} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary">Log in</Link>
          <Link to={TERMINAL_PATH} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Trade now</Link>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <Link to={TERMINAL_PATH} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">Trade now</Link>
          <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={menu ? "Close menu" : "Open menu"} className="p-2">{menu ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
      {menu && <div className="border-t border-border bg-background px-4 py-4 lg:hidden">
        {nav.map(([label, href]) => <a key={href} href={href} onClick={() => setMenu(false)} className="block py-2.5 text-sm font-medium text-muted-foreground">{label}</a>)}
        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3"><ThemeToggle /><Link to={`/login?next=${encodeURIComponent(TERMINAL_PATH)}`} className="text-sm font-medium">Log in</Link><Link to="/" className="ml-auto text-sm text-muted-foreground">FYNX Funded</Link></div>
      </div>}
    </header>

    <main id="trade-main" tabIndex={-1} className="pt-16 focus:outline-none">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border" aria-labelledby="trade-hero-title">
        <div className="pointer-events-none absolute inset-0 dot-grid opacity-60" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-blue-600/15 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-300"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />Web trading platform · Trading opens soon</p>
            <h1 id="trade-hero-title" className="mt-6 text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl">Trade forex.<br />Right in your browser.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">FYNX Trade is the trading platform for FYNX accounts: every forex pair, professional charts and a one-tap order panel that shows your risk in dollars. On desktop and phone, with nothing to install.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={TERMINAL_PATH} className={cta}>Trade now <ArrowRight size={16} /></Link>
              <a href="#platform" className={ghost}>See the platform</a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["No download", `${FOREX_PAIRS.length} forex pairs`, "One FYNX login"].map(t => <li key={t} className="flex items-center gap-1.5"><Check size={15} className="text-emerald-500" aria-hidden="true" />{t}</li>)}
            </ul>
          </div>
          <TerminalPreview />
        </div>
      </section>

      {/* Facts */}
      <section className="border-b border-border" aria-label="FYNX Trade at a glance">
        <dl className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-border md:grid-cols-4">
          {[[String(FOREX_PAIRS.length), "forex pairs: majors, minors and exotics"], ["6", "chart timeframes, 1 minute to 1 day"], ["0.01", "lot minimum volume"], ["0", "downloads: runs in the browser"]].map(([n, l]) =>
            <div key={l} className="bg-background px-6 py-8"><dt className="sr-only">{l}</dt><dd className="text-3xl font-bold tracking-tight sm:text-4xl">{n}</dd><dd className="mt-1 text-sm text-muted-foreground">{l}</dd></div>)}
        </dl>
      </section>

      {/* Platform */}
      <section id="platform" className="scroll-mt-20 border-b border-border" aria-labelledby="platform-title">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600 dark:text-blue-400">The platform</p><h2 id="platform-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Everything a trader expects. Nothing in the way.</h2><p className="mt-4 text-muted-foreground">The layout traders already know: quotes on the left, the chart in the middle, the order panel on the right and your positions underneath.</p></div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { icon: LayoutGrid, title: "Desktop terminal", text: "Market Watch, chart, order panel and the Positions / Pending / History / Account toolbox on one screen." },
              { icon: Smartphone, title: "Phone layout", text: "Quotes, Chart, Trade, History and Account tabs at the bottom of the screen, like a native trading app." },
              { icon: ShieldCheck, title: "Server-side execution", text: "When trading opens, the FYNX server fills each order and checks margin and your challenge rules first. Nothing is decided in your browser." },
            ].map(({ icon: Icon, title, text }) => <div key={title} className="premium-card"><Icon size={22} className="text-blue-600 dark:text-blue-400" aria-hidden="true" /><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p></div>)}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 border-b border-border bg-card/30" aria-labelledby="features-title">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600 dark:text-blue-400">Features</p>
          <h2 id="features-title" className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Built for traders who manage risk first.</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => <div key={title} className="bg-background p-7"><span className="grid h-10 w-10 place-items-center rounded-lg bg-blue-600/10"><Icon size={20} className="text-blue-600 dark:text-blue-400" aria-hidden="true" /></span><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p></div>)}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-border" aria-labelledby="steps-title">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600 dark:text-blue-400">How it works</p>
          <h2 id="steps-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">From purchase to your first trade.</h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => <li key={s.title} className="relative rounded-2xl border border-border p-7"><span className="text-5xl font-bold text-blue-600/25 dark:text-blue-400/25">0{i + 1}</span><h3 className="mt-3 text-lg font-semibold">{s.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p></li>)}
          </ol>
          <div className="mt-10 flex flex-wrap gap-3"><Link to="/challenges" className={cta}>Get an account <ArrowRight size={16} /></Link><Link to={TERMINAL_PATH} className={ghost}>I already have one</Link></div>
        </div>
      </section>

      {/* Markets */}
      <section id="markets" className="scroll-mt-20 border-b border-border bg-card/30" aria-labelledby="markets-title">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600 dark:text-blue-400">Markets</p><h2 id="markets-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{FOREX_PAIRS.length} forex pairs.</h2></div><p className="max-w-md text-sm text-muted-foreground">1.00 lot is 100,000 units of the first currency. A pip is 0.0001, or 0.01 on yen and forint pairs. Spreads, leverage and fees are confirmed before trading opens.</p></div>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {groups.map(([g, list]) => <div key={g} className="rounded-2xl border border-border bg-background p-6"><div className="flex items-center justify-between"><h3 className="font-semibold">{g}</h3><span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">{list.length}</span></div>
              <ul className="mt-4 flex flex-wrap gap-2">{list.map(p => <li key={p.symbol}><Link to={`${TERMINAL_PATH}?symbol=${p.symbol}`} className="inline-block rounded-md border border-border px-2.5 py-1 font-mono text-xs transition hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400">{pairLabel(p)}</Link></li>)}</ul></div>)}
          </div>
        </div>
      </section>

      {/* Partners */}
      <section id="partners" className="scroll-mt-20 border-b border-border" aria-labelledby="partners-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600 dark:text-blue-400">For prop firms & brokers</p>
            <h2 id="partners-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Put your traders on FYNX Trade.</h2>
            <p className="mt-4 text-muted-foreground">FYNX Trade is built to host accounts from more than one business. We're talking to prop firms and brokers who want a modern web terminal for their clients.</p>
            <a href={PARTNER_MAIL} className={`${cta} mt-8`}><Handshake size={16} />Talk to us about a partnership</a>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: Building2, title: "Prop firms", text: "Run evaluations with the daily loss, maximum loss and profit target shown to the trader in dollars." },
              { icon: Globe2, title: "Brokers", text: "Offer a browser terminal that works on every device, under one login for your clients." },
              { icon: Lock, title: "Accounts kept apart", text: "Each trader sees only the accounts bought under their own login." },
              { icon: Bell, title: "Account emails", text: "Customers get an email with a secure link as soon as their account is created." },
            ].map(({ icon: Icon, title, text }) => <li key={title} className="premium-card"><Icon size={20} className="text-blue-600 dark:text-blue-400" aria-hidden="true" /><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1.5 text-sm text-muted-foreground">{text}</p></li>)}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-b border-border bg-card/30" aria-labelledby="trade-faq-title">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h2 id="trade-faq-title" className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Questions</h2>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-background">
            {faqs.map((f, i) => <div key={f.q}>
              <h3><button type="button" aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-medium">{f.q}<ChevronDown size={18} className={`shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`} aria-hidden="true" /></button></h3>
              {openFaq === i && <p className="px-6 pb-5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>}
            </div>)}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden" aria-labelledby="final-cta-title">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-blue-600/10 to-transparent" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <LineChart size={32} className="mx-auto text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="final-cta-title" className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Your markets are one click away.</h2>
          <p className="mt-4 text-muted-foreground">Open the terminal, pick a pair and plan your next trade.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3"><Link to={TERMINAL_PATH} className={cta}>Trade now <ArrowRight size={16} /></Link><Link to="/challenges" className={ghost}>Get an account</Link></div>
        </div>
      </section>
    </main>

    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div><p className="text-lg font-bold">FYNX <span className="font-light text-muted-foreground">Trade</span></p><p className="mt-2 max-w-xs text-sm text-muted-foreground">The web trading platform of the FYNX ecosystem.</p></div>
        <div><p className="text-sm font-semibold">Platform</p><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li><Link to={TERMINAL_PATH} className="hover:text-foreground">Web terminal</Link></li><li><a href="#features" className="hover:text-foreground">Features</a></li><li><a href="#markets" className="hover:text-foreground">Markets</a></li></ul></div>
        <div><p className="text-sm font-semibold">FYNX Funded</p><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li><Link to="/" className="hover:text-foreground">Home</Link></li><li><Link to="/challenges" className="hover:text-foreground">Challenges</Link></li><li><Link to="/rules" className="hover:text-foreground">Trading rules</Link></li><li><Link to="/rules#position-size" className="hover:text-foreground">Lot size calculator</Link></li></ul></div>
        <div><p className="text-sm font-semibold">Help & legal</p><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li><a href="mailto:support@fynxfunded.com" className="inline-flex items-center gap-1 hover:text-foreground"><Mail size={13} aria-hidden="true" />support@fynxfunded.com</a></li><li><Link to="/terms" className="hover:text-foreground">Terms</Link></li><li><Link to="/privacy" className="hover:text-foreground">Privacy</Link></li><li><Link to="/risk-disclosure" className="hover:text-foreground">Risk disclosure</Link></li></ul></div>
      </div>
      <p className="mx-auto max-w-7xl border-t border-border px-4 py-6 text-xs leading-relaxed text-muted-foreground sm:px-6">Trading foreign exchange carries a high level of risk. FYNX Funded evaluation and funded-stage accounts are simulated and balances are virtual. Charts and quotes are supplied by TradingView for display only. Trading on FYNX Trade is not yet open. © {new Date().getFullYear()} FYNX.</p>
    </footer>
  </div>;
}

/** Drawn illustration of the terminal (no prices: it is a picture, not a quote). */
function TerminalPreview() {
  const candles = [[60, 40, 70, 30], [45, 52, 62, 38], [52, 44, 58, 36], [44, 58, 64, 40], [58, 66, 72, 52], [66, 60, 74, 54], [60, 72, 78, 56], [72, 80, 88, 68], [80, 74, 86, 66], [74, 86, 92, 70], [86, 82, 94, 76], [82, 96, 100, 78], [96, 90, 104, 86], [90, 104, 110, 86]];
  const y = (v: number) => 150 - v * 1.2;
  return <figure className="relative" aria-label="Illustration of the FYNX Trade terminal">
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-blue-600/10">
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" /><span className="ml-3 text-xs text-muted-foreground">FYNX Trade · Web terminal</span></div>
      <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[130px_1fr_150px]">
        <div className="border-r border-border p-2">
          <p className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Market Watch</p>
          {["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "GBPJPY", "EURGBP"].map((s, i) => <div key={s} className={`flex items-center justify-between rounded px-1.5 py-1.5 font-mono text-[10px] ${i === 0 ? "bg-blue-600/15" : ""}`}><span className="font-semibold">{s}</span>{i < 3 && <Star size={9} className="fill-amber-400 text-amber-400" />}</div>)}
        </div>
        <div className="p-3">
          <div className="flex items-center justify-between"><span className="text-sm font-semibold">EUR/USD</span><span className="flex gap-1">{["5m", "15m", "1H"].map((t, i) => <span key={t} className={`rounded px-1.5 py-0.5 text-[9px] ${i === 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{t}</span>)}</span></div>
          <svg viewBox="0 0 230 160" className="mt-2 h-40 w-full" aria-hidden="true">
            {[30, 70, 110, 150].map(g => <line key={g} x1="0" x2="230" y1={g} y2={g} className="stroke-border" strokeWidth="0.5" />)}
            {candles.map(([o, c, h, l], i) => { const x = 10 + i * 15.5, up = c >= o; return <g key={i} className={up ? "fill-emerald-500 stroke-emerald-500" : "fill-red-500 stroke-red-500"}><line x1={x} x2={x} y1={y(h)} y2={y(l)} strokeWidth="1" /><rect x={x - 4} y={y(Math.max(o, c))} width="8" height={Math.max(2, Math.abs(c - o) * 1.2)} rx="1" /></g>; })}
          </svg>
        </div>
        <div className="col-span-2 border-t border-border p-3 sm:col-span-1 sm:border-l sm:border-t-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">New order</p>
          <div className="mt-2 rounded border border-border py-1.5 text-center font-mono text-xs font-semibold">0.10 lots</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5"><span className="rounded bg-red-600 py-2 text-center text-[11px] font-bold text-white">SELL</span><span className="rounded bg-blue-600 py-2 text-center text-[11px] font-bold text-white">BUY</span></div>
          <div className="mt-2 space-y-1 text-[9px] text-muted-foreground"><div className="flex justify-between"><span>Stop loss</span><span>20 pips</span></div><div className="flex justify-between"><span>Risk</span><span className="text-foreground">$20.00</span></div><div className="flex justify-between"><span>Reward : risk</span><span>2 : 1</span></div></div>
        </div>
      </div>
    </div>
    <figcaption className="mt-3 text-center text-xs text-muted-foreground">Illustration of the FYNX Trade terminal.</figcaption>
  </figure>;
}
