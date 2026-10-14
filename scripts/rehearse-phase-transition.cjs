#!/usr/bin/env node
// Complete synthetic transaction rehearsal. Cannot target a cloud database.
const fs=require('node:fs'),path=require('node:path'),admin=require('../functions/node_modules/firebase-admin');
const {previewPhaseTransition,executePhaseTransition,verifyPhaseArchive}=require('../functions/lib/fundedPhaseTransition');
const {build,bind}=require('../functions/lib/purchasedAgreement');
const report={checkedAt:new Date().toISOString(),environment:'local Firestore emulator; synthetic records only',checks:[],productionProgression:false};
const check=(name,passed)=>{report.checks.push({name,passed:!!passed});if(!passed)throw Error(name)};
async function main(){
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('A local Firestore emulator is required');
 admin.initializeApp({projectId:'demo-funded-retention'});const db=admin.firestore(),uid='synthetic-phase-qa',challengeId='phase-qa',nextId='phase-qa-next',orderId='phase-qa-order';
 const start='2026-10-01T00:00:00Z',through='2026-10-05T10:00:00Z';
 const purchase=build({uid,program:'2-phase',starting_balance:'10000',accepted_version:'fynx-funded-v1',accepted:true,now:start});
 const policy=bind(purchase,{uid,order_id:orderId,program:'2-phase',starting_balance:'10000',start_timestamp:start,expected_hash:purchase.document_sha256});
 policy.coverage={complete:true,pagination_complete:true,equity_complete:true,source_reference:'SYNTHETIC-NOT-BROKER',adapter_version:'fixture',reviewed_by:'fixture-only',reviewed_at:through,source_sha256:'b'.repeat(64),from:start,through,event_count:5,source_sequence_start:1,source_sequence_end:5,account_id:'old-broker',phase_reference:`order:${orderId}:phase:1`};
 const challenge={userId:uid,orderId,currentPhase:1,phase:'2-phase',accountSize:10000,currency:'USD',brokerAccountId:'old-broker',rulePolicyVersion:'fynx-funded-v1',rulePolicy:policy,status:'active'};
 const archive=db.doc(`funded_phase_archives/${challengeId}/phases/1`);
 try{
  await db.doc(`challenges/${challengeId}`).set(challenge);await db.doc(`orders/${orderId}`).set({userId:uid,status:'paid',purchasedRules:purchase});
  await db.doc(`accounts/${nextId}`).set({userId:uid,challengeId,phase:2,brokerAccountId:'next-broker',currency:'USD',startingBalance:'10000',provisioningStatus:'verified',integrationReference:'SYNTHETIC-ONLY',activatedAt:'2026-10-06T00:00:00Z'});
  for(let i=1;i<=5;i++)await db.doc(`rule_events/phase-qa-${i}`).set({userId:uid,challengeId,sequence:i,timestamp:`2026-10-0${i}T10:00:00Z`,event_type:'closed_trade',realized_pnl:'200',unrealized_pnl_after:'0',open_position_count:0,pnl_basis:'net_after_all_costs',account_id:'old-broker',phase_reference:policy.coverage.phase_reference,source_sequence:i,source_event_id:'fixture-'+i,broker_balance:String(10000+200*i),broker_equity:String(10000+200*i)});
  let review=await previewPhaseTransition(db,challengeId,nextId);check('Preview reconciles five days without authorizing progression',review.authorizesTransition===false&&review.plan.eventCount===5);
  let blocked=false;try{await executePhaseTransition(db,review.plan,review.hash,'fixture-reviewer')}catch{blocked=true}check('Missing release approval cannot progress or create an archive',blocked&&!(await archive.get()).exists&&(await db.doc(`challenges/${challengeId}`).get()).data().currentPhase===1);
  await db.doc('funded_release/current').set({progressionApproved:true,reviewedBy:'fixture-only',integrationReference:'SYNTHETIC-ONLY',parallelProof:{sealed:true,reconciled:true,evidenceReference:'SYNTHETIC-ONLY',sha256:'c'.repeat(64),startedAt:'2026-09-01T00:00:00Z',completedAt:'2026-09-08T00:00:00Z'}});
  await db.doc(`challenges/${challengeId}`).update({status:'failed',breachRecorded:true});blocked=false;try{await executePhaseTransition(db,review.plan,review.hash,'fixture-reviewer')}catch{blocked=true}check('A recorded breach cannot be cleared by transition',blocked&&!(await archive.get()).exists);
  await db.doc(`challenges/${challengeId}`).set(challenge);review=await previewPhaseTransition(db,challengeId,nextId);
  await db.doc(`accounts/${nextId}`).update({note:'changed after review'});blocked=false;try{await executePhaseTransition(db,review.plan,review.hash,'fixture-reviewer')}catch{blocked=true}check('Account changes invalidate the reviewed plan',blocked&&!(await archive.get()).exists);
  review=await previewPhaseTransition(db,challengeId,nextId);
  const attempts=await Promise.allSettled([executePhaseTransition(db,review.plan,review.hash,'fixture-reviewer'),executePhaseTransition(db,review.plan,review.hash,'fixture-reviewer')]);
  check('Concurrent transition attempts commit exactly once',attempts.filter(x=>x.status==='fulfilled').length===1);
  const current=(await db.doc(`challenges/${challengeId}`).get()).data(),sealed=(await archive.get()).data(),events=(await archive.collection('events').get()).docs.map(d=>({id:d.id,data:d.data()}));
  check('Old phase is fully archived while new phase awaits actual broker evidence',current.currentPhase===2&&current.rulePolicy.coverage===null&&sealed.sealed===true&&events.length===5&&(await db.collection('rule_events').where('challengeId','==',challengeId).get()).empty);
  check('Archived policy and every event match the sealed digest',verifyPhaseArchive(sealed,events));events[0].data.broker_equity='1';check('Archive tampering is detected',!verifyPhaseArchive(sealed,events));
  report.complete=true;
 }finally{
  for(const p of [`challenges/${challengeId}`,`orders/${orderId}`,`accounts/${nextId}`,'funded_release/current',`funded_phase_archives/${challengeId}`,`funded_phase_transitions/${challengeId}_1`])await db.recursiveDelete(db.doc(p));
  for(let i=1;i<=5;i++)await db.doc(`rule_events/phase-qa-${i}`).delete();report.cleanup=true;
  fs.writeFileSync(path.join(__dirname,'../docs/ios-completion-2026-10-12/phase-rehearsal.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
