import MarketingLayout from "./MarketingLayout";

export interface Section {
  id: string;
  title: string;
  content?: React.ReactNode;
}

interface LegalPageLayoutProps {
  title: string;
  lastUpdated: string;
  disclaimer?: string;
  sections: Section[];
  children?: React.ReactNode;
}

export default function LegalPageLayout({ title, lastUpdated, disclaimer, sections, children }: LegalPageLayoutProps) {
  return (
    <MarketingLayout>
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-12 animate-fade-up">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">{title}</h1>
          <p className="text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
          <div className="mt-4 rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            New purchases are paused while the launch terms and billing policies complete their final review. Existing purchases remain subject to the terms accepted at purchase.
          </div>
          {disclaimer && (
            <div className="mt-4 border border-border bg-accent/30 rounded-md px-4 py-3">
              <p className="text-xs text-muted-foreground italic">⚠ {disclaimer}</p>
            </div>
          )}
        </div>

        {/* Table of Contents */}
        <nav id="contents" aria-labelledby="contents-heading" className="mb-12 scroll-mt-24 border border-border rounded-md p-5 bg-card animate-fade-up delay-100">
          <h2 id="contents-heading" className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Table of Contents</h2>
          <ol className="space-y-1.5">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* Sections */}
        {children ? (
          <div className="prose-sm">{children}</div>
        ) : (
          <div className="space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-24 animate-fade-up" style={{ animationDelay: `${0.1 + i * 0.03}s` }}>
                <h2 className="text-lg font-semibold mb-3">
                  {i + 1}. {s.title}
                </h2>
                <div className="text-sm text-muted-foreground leading-relaxed space-y-3">
                  {s.content}
                </div>
                <a href="#contents" className="mt-4 inline-block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  ↑ Back to contents<span className="sr-only"> (from {s.title})</span>
                </a>
              </section>
            ))}
          </div>
        )}
      </div>
    </MarketingLayout>
  );
}
