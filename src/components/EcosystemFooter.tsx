const destinations = [{"name": "FYNX Finance World", "href": "https://www.fynxfinanceworld.com/"}, {"name": "FYNX Funded", "href": "https://www.fynxfunded.com/"}, {"name": "FYNX Blog / Journal", "href": "https://blog.fynxfinanceworld.com/"}, {"name": "FYNX Roadmap", "href": "https://roadmap.fynxfinanceworld.com/"}, {"name": "FYNX Mobile App", "href": "https://site.fynxfinanceworld.com/"}, {"name": "FYNX API", "href": "https://www.fynxfinanceworld.com/api/"}];

export default function EcosystemFooter() {
  return <nav aria-label="FYNX ecosystem" className="border-t border-border mt-8 py-8">
    <h2 className="text-sm font-semibold uppercase tracking-wider mb-4">FYNX Ecosystem</h2>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
      {destinations.map(({ name, href }) => <a key={href} href={href} className="flex items-center min-h-11 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{name}</a>)}
    </div>
  </nav>;
}
