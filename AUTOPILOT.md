# Autopilot backlog (fynxfunded)

Prioritized, page by page. One to three focused changes per run. Safety: no changes to Firestore rules, auth/MFA, payments/checkout, trade fills, balances or evaluation outcomes.

## Site-wide
- [x] Friendly 404 page with navigation, helpful links and correct title/noindex (2026-11-03)
- [x] Footer "Trade Now" spacing fix (2026-11-03)
- [ ] Footer "Discord" / "Twitter" are plain text, not links: link them once real URLs are confirmed (or hide)
- [x] Footer support email is now a clickable mailto link (2026-11-03)
- [x] Opening a shared link like /payouts#calendar or /faq#daily-loss directly now jumps to that section (was: stayed at the top of the page) (2026-11-04)
- [x] New pages open at the top and #section links jump to the section (was: footer links left you at the bottom of the next page) (2026-11-03)
- [x] Removed the long "FYNX Ecosystem" link list from the bottom of every page at the owner's request; the same destinations stay in the header ecosystem menu (and the dashboard Resources page) (2026-11-04)
- [ ] Performance: main bundle chunk is >500 kB; split heavy routes/libs further
- [ ] Accessibility pass (skip-to-content link, focus outlines, heading order)
- [ ] Translate 404, FAQ and calculator into the languages offered by the language selector

## Home (/)
- [x] Plan cards show phase 1 target, daily loss, max loss and minimum days in dollars, plus "See these rules in dollars" calculator links (2026-11-04)
- [x] "Know your numbers" section: links to calculator, program comparison and payout estimator, plus the live next payout window (2026-11-04)
- [ ] Hero: review copy and spacing on small phones

## Challenges (/challenges)
- [x] Side-by-side comparison of 1/2/3-phase programs for a chosen size, in dollars (2026-11-03)
- [x] Link each plan to the rules calculator preset for that size/program (2026-11-03)
- [ ] Let "Start challenge" preselect size/program in the builder (needs care: builder feeds checkout)

## How it works (/how-it-works)
- [x] Program/size picker showing every phase in dollars, plus "How a trading day works" (2026-11-03)
- [ ] Make the chosen program/size shareable in the URL

## Trading rules (/rules)
- [x] Rules calculator: targets/floors in dollars, today's loss floor, 40% consistency check (2026-11-03)
- [x] Let the calculator pick which phase you're in (2026-11-03)
- [x] Accept size/program/phase from the URL and keep the address shareable (2026-11-03)

## Payouts (/payouts)
- [x] Payout split estimator from approved profit-split table, clearly labelled estimate (2026-11-03)
- [x] Fix incomplete profit-split tiers: full size × program table from the catalog (2026-11-03)
- [x] Payout calendar: live "next request window" card based on today's date, linkable as /payouts#calendar (2026-11-03)
- [x] "Add both windows to my calendar" (.ics download for the next two request windows) (2026-11-04)

## FAQ (/faq)
- [x] Search, FAQPage structured data, related links and "Email support" block (2026-11-03)
- [x] Questions grouped by topic with filter chips; 13 new answers (reset time, loss floors, consistency, targets, days, split, payout windows, verification) with figures pulled from the published schedule (2026-11-03)
- [x] Each question has its own shareable link (/faq#question-id) and a next-step link (2026-11-03)
- [x] Home FAQ preview: curated questions from the real FAQ, each linking to its answer (/faq#id) (2026-11-04)

## Legal pages (/terms, /privacy, /risk-disclosure, /refund-policy, /aml-kyc)
- [x] Table of contents with anchor links and "last updated" date (already present; verified 2026-11-03)
- [ ] Highlight the current section in the table of contents while scrolling

## Dashboard (/dashboard/*)
- [ ] Walk signed-in pages with emulator data; check empty states on mobile
- [ ] Add tests covering public marketing pages render (Index, Challenges, Rules, Payouts)
