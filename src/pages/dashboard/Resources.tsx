import { Apple, ArrowUpRight, BookOpen, Calculator, CalendarDays, FileText, Globe2, Handshake, Newspaper, NotebookPen, ShieldAlert } from "lucide-react";
const links=[
  ["FYNX Finance World","News, journals, calculators and market resources.","https://www.fynxfinanceworld.com",Globe2],
  ["FYNX Finance World App","Download the official iPhone and iPad application.","https://apps.apple.com/us/app/fynx-finance-world/id6752357210",Apple],
  ["FYNX Whitepaper","Read the FYNX product and ecosystem whitepaper.","https://www.fynxfinanceworld.com/assets/docs/FYNX-Whitepaper.pdf",FileText],
  ["Trading Tools","Position size, pip, margin, R:R and other calculators.","https://www.fynxfinanceworld.com/waitlist.html?source=grow-tools",Calculator],
  ["Trader Journal","Plan, record and review trading decisions.","https://www.fynxfinanceworld.com/journal.html",NotebookPen],
  ["Economic Calendar","Monitor market-moving events and releases.","https://www.fynxfinanceworld.com/tools/economic-calendar.html",CalendarDays],
  ["Market News","Read the latest financial market coverage.","https://www.fynxfinanceworld.com/news.html",Newspaper],
  ["Learning Center","Explore market education and trading topics.","https://www.fynxfinanceworld.com/learn/topic.html?section=howto&topic=forex",BookOpen],
  ["Partners","Review funded platforms, brokers and trading tools.","https://www.fynxfinanceworld.com/partners.html",Handshake],
  ["Risk Disclosure","Understand the risks of trading and leverage.","https://www.fynxfinanceworld.com/risk-disclosure.html",ShieldAlert],
  ["Affiliate Disclosure","Review partnership and compensation disclosures.","https://www.fynxfinanceworld.com/affiliate-disclosure.html",FileText],
];
export default function Resources(){return <div className="space-y-6 animate-fade-up"><div><p className="text-xs uppercase tracking-[.2em] text-muted-foreground">FYNX ecosystem</p><h1 className="mt-1 text-2xl font-bold">Resources & Mobile App</h1><p className="mt-1 text-sm text-muted-foreground">Open official FYNX tools, research, education and documentation.</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{links.map(([name,desc,url,Icon]:any)=><a key={name} href={url} target="_blank" rel="noreferrer" className="premium-card group block hover:border-foreground/25 hover:bg-secondary/20 transition-colors"><div className="flex items-start justify-between"><span className="rounded-lg bg-secondary p-2.5"><Icon size={19}/></span><ArrowUpRight size={17} className="text-muted-foreground transition-transform group-hover:-translate-y-1 group-hover:translate-x-1"/></div><h2 className="mt-5 font-semibold">{name}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{desc}</p></a>)}</div><p className="text-xs text-muted-foreground">External resources open in a new tab. Market information is educational and is not financial advice.</p></div>}
