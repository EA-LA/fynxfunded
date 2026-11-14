import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Grid3X3, ExternalLink, Globe, FileText, BookOpen, Layers, LineChart } from "lucide-react";

const ecosystemLinks = [
  {
    label: "FYNX App",
    desc: "Mobile trading companion",
    href: "https://apps.apple.com",
    icon: Layers,
    external: true,
  },
  {
    label: "Main Platform",
    desc: "fynxfinanceworld.com",
    href: "https://fynxfinanceworld.com",
    icon: Globe,
    external: true,
  },
  {
    label: "Blog",
    desc: "Insights & updates",
    href: "https://blog.fynxfinanceworld.com",
    icon: BookOpen,
    external: true,
  },
  {
    label: "Whitepaper",
    desc: "Technical documentation",
    href: "https://www.fynxfinanceworld.com/assets/docs/FYNX-Whitepaper.pdf",
    icon: FileText,
    external: true,
  },
  {
    label: "FYNX Funded",
    desc: "Trading evaluations",
    href: "/",
    icon: Grid3X3,
    external: false,
  },
  {
    label: "FYNX Trade",
    desc: "Web trading platform",
    href: "/trade",
    icon: LineChart,
    external: false,
  },
];

export default function EcosystemSwitch() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const activeHref = pathname.startsWith("/trade") ? "/trade" : "/";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-secondary transition-colors"
        aria-label="FYNX Ecosystem"
      >
        <Grid3X3 size={14} className="text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-popover border border-border rounded-md shadow-lg z-50 animate-fade-in overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Ecosystem</p>
          </div>
          <div className="py-1">
            {ecosystemLinks.map((entry) => {
              const link = { ...entry, active: !entry.external && entry.href === activeHref, desc: !entry.external && entry.href === activeHref ? "You are here" : entry.desc };
              const content = (
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                    link.active
                      ? "bg-secondary/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <link.icon size={15} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-tight">{link.label}</p>
                    <p className="text-xs text-muted-foreground/70 leading-tight">{link.desc}</p>
                  </div>
                  {link.external && <ExternalLink size={12} className="shrink-0 opacity-40" />}
                </div>
              );

              if (link.external) {
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                  >
                    {content}
                  </a>
                );
              }

              if (link.active) {
                return (
                  <div key={link.label} className="cursor-default" aria-current="page">
                    {content}
                  </div>
                );
              }

              return (
                <Link key={link.label} to={link.href} onClick={() => setOpen(false)}>
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
