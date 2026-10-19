import { build, bind } from './purchasedAgreement';

const canonical = (value: any): string => JSON.stringify(value === null || typeof value !== 'object' ? value : Array.isArray(value)
  ? value.map(item => JSON.parse(canonical(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));

/** Firestore map ordering is not stable. Preserve the original versioned digest, not stored key order. */
export function bindRecordedRules(purchase: any, input: any) {
  if (purchase?.document) {
    const expected = build({ uid: input.uid, program: input.program, starting_balance: input.starting_balance,
      accepted_version: purchase.document.policy_version, accepted: true, now: purchase.accepted_at });
    // Reordering is allowed only after exact structural equality. Hash, owner, acceptance and version
    // validation still run in the canonical binder; altered values are never repaired or re-approved.
    if (canonical(purchase.document) === canonical(expected.document)) purchase = { ...purchase, document: expected.document };
  }
  return bind(purchase, input);
}
