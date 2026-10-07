# Funded service rollout — October 7, 2026

Owner for launch and rollback: Elham Amini (confirmed in this session). Commercial launch is not approved by this engineering release.

## Delivered and verified

- Nine selected Firebase functions deployed successfully: native customer actions, workspace, leaderboard job, MFA callable (activation off), native checkout (purchase hold on), native Identity entry point, privacy, and both progression safeguards.
- Manual pass/fund actions now reject attempts to bypass the unapproved transition workflow. Failure decisions require a reason, persist breach evidence and write the audit atomically. Owner controls require verified email and respect the MFA gate. Versioned history is read in the evaluation transaction and a changed broker binding aborts it.
- Authenticated Funded export excludes security credentials, other customers and the shared Tools/API products. It fails instead of returning truncated data. The new settings controls download JSON and submit/check a Funded-only deletion request.
- Deletion requests are retry-safe and explicitly pending review. They do not erase records or delete the shared Firebase identity.
- Twelve production smoke checks passed using a disposable QA identity. Tested authentication, ownership, profile persistence, document reads, scoped export, deletion request/status and the checkout/MFA holds. All test records and the QA identity were removed. Email verification was preset by the test administrator; this is not evidence of a real email/OAuth/device journey.
- Production backups: daily with 28-day retention, weekly with 84-day retention, 18 READY backups at inspection, newest October 7. Point-in-time recovery enabled. Ten enabled alert policies and one enabled email channel observed. This does not prove recipient delivery or restoration.
- Production still has five challenges and zero broker accounts, trades, rule events, issued contracts or Funded memberships. No history or customer-facing content was invented.
- Complete unsigned and signed iOS Debug builds succeeded. The signed application was installed and launched on the owner's connected iPhone. Face ID, provider authentication and account comparisons still require observed device results.
- Existing iOS implementation already includes Trader's Analysis, the scenario lab, Funded market desk and 20 localization catalogs. Native-speaker review remains outstanding.

## Release boundaries

The clean release is based on the current remote main branch. It preserves the existing website authentication flow and production rules. The compatible MFA website/rules migration remains a separate coordinated release; deploying `fundedMfa` does not activate it. Native checkout intentionally has `STRIPE_PUBLISHABLE_KEY=unconfigured`, which is not a Stripe key and cannot enable payment. Existing Stripe secret bindings are preserved; no live charge or identity document submission was made.

Native PaymentIntent webhook fulfillment and coordinated customer-action/payment verification remain pending before purchases can open. Publishing empty catalogs is not supplying approved contracts, offers, membership terms or coaching slots. New services return actual available data or an empty/unavailable state.

## Reproduce

```sh
npm ci
npm ci --prefix functions
npm run check:release
```

`scripts/deploy-funded-services.cjs --deploy` stages only the named exports; it does not publish Firestore rules or activate MFA/payments. The read-only operations audit and production smoke script require authorized local Google credentials. The smoke script needs the explicit `--run-production` flag and cleans up only its own QA identity/records. Never use customer credentials for it.

Evidence: `operations.json`, `services-deployment.json`, `live-service-checks.json`. Function source hashes identify the deployed snapshot; post-deployment source edits require a new deployment.

## Retention and restoration procedure

The new request intake is implemented; destructive retention execution is not approved or claimed complete. Before fulfilling a request, the operator must inventory related records, identify open orders/payouts/disputes, apply the legally approved record-specific retention policy, and preserve the evidence of that decision. Do not remove a shared FYNX Authentication identity as a Funded-only deletion.

Before deleting approved records, record a deletion ledger in a protected location outside the database backup being restored. Include request reference, exact affected paths, completion time and retained-record exceptions; restrict access. A database restore must first target an isolated database with client access and triggers disabled. Reapply completed deletions using the current ledger, verify retained exceptions and ownership, validate counts/hashes and access rules, then obtain owner approval before redirecting production. A missing ledger, unexplained discrepancy or resurrected record blocks release of the restored database. A real restoration drill, tested deletion executor and approved retention periods are still required.

## Rollback

Keep purchases paused and MFA activation off. For a failed new endpoint, disable its access and deploy the last reviewed safe implementation; do not restore manual progression bypasses or clear recorded breaches. Do not revert source broadly from the older dirty checkout. Existing functions and the clean PR allow review of the exact scope. Preserve audit records and privacy requests during recovery. Owner: Elham Amini.
