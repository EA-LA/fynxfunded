// Read-only reconciliation; no provider calls, status changes or payment replay.
const admin = require('../functions/node_modules/firebase-admin');
const { orderLifecycle } = require('../functions/lib/fundedProvisioningPolicy');
async function main() {
  admin.initializeApp({projectId:'fynx-c7a28'}); const db=admin.firestore();
  const report={checkedAt:new Date().toISOString(),readOnly:true,providerReconciliation:false,orders:0,accounts:0,states:{},findings:[]};
  const payments=new Map(); let last;
  for (;;) {
    let q=db.collection('orders').orderBy(admin.firestore.FieldPath.documentId()).limit(200); if(last)q=q.startAfter(last);
    const page=await q.get(); if(page.empty)break;
    for(const d of page.docs) {
      report.orders++;const o=d.data();let c,a;
      const ref=o.stripeSessionId||o.stripePaymentIntentId;
      if(ref){if(payments.has(ref))report.findings.push({orderId:d.id,reason:'duplicate_payment_reference'});payments.set(ref,d.id);}
      if(o.challengeId && !String(o.challengeId).includes('/'))c=(await db.doc(`challenges/${o.challengeId}`).get()).data();
      if(c?.brokerAccountId && !String(c.brokerAccountId).includes('/'))a=(await db.doc(`accounts/${c.brokerAccountId}`).get()).data();
      if(c && (c.userId!==o.userId||c.orderId!==d.id)||a && (a.userId!==o.userId||a.challengeId!==o.challengeId)) report.findings.push({orderId:d.id,reason:'ownership_or_binding_conflict'});
      if(o.status==='paid'&&!c)report.findings.push({orderId:d.id,reason:'paid_order_missing_challenge'});
      const state=orderLifecycle(o,c,a).state;report.states[state]=(report.states[state]||0)+1;
      if(['account_pending','provisioning_failed','review_required'].includes(state))report.findings.push({orderId:d.id,reason:state});
    }
    last=page.docs.at(-1);
  }
  last=undefined;
  for (;;) {
    let q=db.collection('accounts').orderBy(admin.firestore.FieldPath.documentId()).limit(200);if(last)q=q.startAfter(last);
    const page=await q.get();if(page.empty)break;
    for(const d of page.docs){report.accounts++;const a=d.data();if(a.password)report.findings.push({accountId:d.id,reason:'legacy_plaintext_requires_migration'});if(!a.challengeId||String(a.challengeId).includes('/')){report.findings.push({accountId:d.id,reason:'orphan_account'});continue;}const c=(await db.doc(`challenges/${a.challengeId}`).get()).data();if(!c||c.userId!==a.userId||c.brokerAccountId!==d.id)report.findings.push({accountId:d.id,reason:'orphan_or_unbound_account'});}
    last=page.docs.at(-1);
  }
  console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Reconciliation failed; no complete report produced.');process.exitCode=1;});
