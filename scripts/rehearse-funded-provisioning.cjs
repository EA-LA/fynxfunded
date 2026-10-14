const admin=require('../functions/node_modules/firebase-admin'),crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs');
const {provisionAccount}=require('../functions/lib/fundedProvisionAccount'),{openCredential}=require('../functions/lib/fundedCredentialVault');
async function main(){
 if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('A local emulator is required.');
 admin.initializeApp({projectId:'demo-funded-retention'});const db=admin.firestore();
 const key=crypto.randomBytes(32).toString('base64'),uid='provision-qa',base={userId:uid,challengeId:'provision-c',accountId:'provision-a',platform:'Synthetic',server:'demo',login:'qa',password:'synthetic-only-password',providerReference:'synthetic-only-proof',providerConfirmedAt:new Date().toISOString(),environment:'simulated',reviewedBy:'automated-local-test'};
 const {reconcileOrders}=require('../functions/lib/fundedReconciliation');
 const checks=[];const pass=n=>checks.push({name:n,passed:true});
 await db.doc('orders/provision-o').set({userId:uid,status:'paid',challengeId:base.challengeId});await db.doc('challenges/'+base.challengeId).set({userId:uid,orderId:'provision-o',status:'active',currentPhase:1});
 const outcomes=await Promise.all([provisionAccount(db,base,key),provisionAccount(db,base,key)]);assert.equal(outcomes.filter(o=>!o.alreadyProvisioned).length,1);pass('Concurrent provider binding commits once');
 const a=(await db.doc('accounts/'+base.accountId).get()).data(),v=(await db.doc('funded_account_secrets/'+base.accountId).get()).data();assert.equal(a.password,undefined);assert.equal(openCredential(v,base,key),base.password);pass('Public metadata has no password; private ciphertext decrypts');
 const binding=(await db.doc('challenges/'+base.challengeId).get()).data();assert.equal(binding.brokerAccountId,base.accountId);assert.equal(binding.status,'active');pass('Challenge bound without changing phase or outcome');
 await assert.rejects(provisionAccount(db,{...base,accountId:'different'},key));pass('Existing challenge cannot be rebound');
 await assert.rejects(provisionAccount(db,{...base,password:'different'},key));pass('Repeated imports cannot silently rotate credentials');
 await db.doc('orders/provision-o').update({status:'refunded'});await assert.rejects(provisionAccount(db,base,key));pass('Refunded order cannot provision');
 await assert.rejects(provisionAccount(db,{...base,userId:'other'},key));pass('Wrong owner cannot provision');
 await assert.rejects(provisionAccount(db,{...base,tradingUrl:'https://example.com?token=secret'},key));pass('Token-bearing trading URL rejected');
 await db.doc('orders/provision-o').update({stripeSessionId:'duplicate'});await db.doc('orders/provision-duplicate').set({userId:'other',status:'paid',stripeSessionId:'duplicate',challengeId:base.challengeId});
 const before=(await db.doc('challenges/'+base.challengeId).get()).data();const report=await reconcileOrders(db);assert(report.findings.some(f=>f.reason==='duplicate_payment_reference'));assert(report.findings.some(f=>f.reason==='binding_conflict'));pass('Reconciliation detects duplicates and conflicting ownership');assert.deepEqual((await db.doc('challenges/'+base.challengeId).get()).data(),before);pass('Reconciliation does not mutate account or payment state');
 fs.writeFileSync('docs/launch-2026-10-14/provisioning-rehearsal.json',JSON.stringify({localEmulator:true,synthetic:true,providerProof:false,checks},null,2)+'\n');console.log(checks.length+' real local Firestore provisioning checks passed.');await admin.app().delete();
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
