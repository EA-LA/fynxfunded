import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import MarketingLayout from "@/components/MarketingLayout";

const helpfulLinks = [
  { to: "/challenges", label: "Challenges & pricing", description: "Compare evaluation sizes and objectives." },
  { to: "/how-it-works", label: "How it works", description: "See the evaluation journey step by step." },
  { to: "/rules", label: "Trading rules", description: "Daily loss limits, drawdown and requirements." },
  { to: "/faq", label: "FAQ", description: "Answers to the most common questions." },
];

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    document.title = "Page not found | FYNX Funded";
    document.querySelector('meta[name="robots"]')?.setAttribute("content", "noindex, follow");
  }, [location.pathname]);

  return (
    <MarketingLayout>
      <section className="max-w-3xl mx-auto px-6 py-24 md:py-32" aria-labelledby="not-found-title">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Error 404</p>
        <h1 id="not-found-title" className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">
          We couldn't find that page
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The link may be outdated or the address may have a typo. Here are some places to pick up from.
        </p>
        <p className="mt-2 break-all text-sm text-muted-foreground">
          Requested: <code className="font-mono">{location.pathname}</code>
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Back to home
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 border border-border px-6 py-3 rounded-md text-sm font-semibold hover:bg-accent transition-colors"
          >
            Go to my dashboard
          </Link>
        </div>

        <nav aria-label="Popular pages" className="mt-14">
          <h2 className="text-sm font-semibold mb-4">Popular pages</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {helpfulLinks.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="group premium-card flex h-full items-start justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">{link.label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{link.description}</span>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="mt-12 text-sm text-muted-foreground">
          Still stuck? Email{" "}
          <a href="mailto:support@fynxfunded.com" className="underline underline-offset-4 hover:text-foreground">
            support@fynxfunded.com
          </a>
          .
        </p>
      </section>
    </MarketingLayout>
  );
};

export default NotFound;
