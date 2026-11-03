# Autopilot backlog (fynxfunded)

Prioritized ideas the autopilot works through, one focused change per run. Safety: no changes to Firestore rules, auth/MFA, payments/checkout, trade fills, balances or evaluation outcomes.

- [x] Friendly 404 page with navigation, helpful links and correct title/noindex (2026-11-03)
- [x] Footer "Trade Now" spacing fix (2026-11-03)
- [ ] FAQ: add FAQPage structured data for Google rich results, and a "Still have questions? Contact support" block
- [ ] Footer "Discord" / "Twitter" are plain text, not links — link them once real URLs are confirmed (or hide)
- [ ] Footer support email: make it a clickable mailto link (it currently wraps mid-word on phones)
- [ ] Mobile: the ecosystem footer list has very tall spacing on phones — tighten it
- [ ] Performance: main bundle chunk is >500 kB — split heavy routes/libs further
- [ ] Accessibility pass on public pages (focus outlines, skip-to-content link, heading order)
- [ ] Translate the 404 page and FAQ into the languages offered by the language selector
- [ ] Add tests covering public marketing pages render (Index, Challenges, Rules, Payouts)
