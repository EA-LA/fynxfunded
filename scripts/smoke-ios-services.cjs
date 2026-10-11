#!/usr/bin/env node
// Disposable synthetic QA only. No emails, payments, broker activity or real-customer edits.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),admin=require('../functions/node_modules/firebase-admin');
const report={checkedAt:new Date().toISOString(),project:'fynx-c7a28',data:'temporary synthetic QA; not real broker evidence',checks:[],cleanup:false};
const check=(name,condition)=>{report.checks.push({name,passed:!!condition});if(!condition)throw Error('Check failed: '+name)};
async function main(){
 if(!process.argv.includes('--run-production'))throw Error('Explicit --run-production required.');
 const cli=process.env.FIREBASE_CLI_LIB || path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'firebase-tools/lib');
 const api=require(path.join(cli,'api')),config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/configstore/firebase-tools.json')));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fynx-ios-smoke-auth-')),adc=path.join(temp,'adc.json');
 fs.writeFileSync(adc,JSON.stringify({type:'authorized_user',client_id:api.clientId(),client_secret:api.clientSecret(),refresh_token:config.tokens.refresh_token}),{mode:0o600});
 process.env.GOOGLE_APPLICATION_CREDENTIALS=adc;
 admin.initializeApp({projectId:'fynx-c7a28'});const db=admin.firestore();
 const uid='funded-ios-qa-'+crypto.randomBytes(10).toString('hex'),challengeId=uid+'-challenge',eventId=uid+'-event',fakeToken='QA_NOT_DELIVERABLE_'+crypto.randomBytes(32).toString('hex');
 const tokenID=crypto.createHash('sha256').update(fakeToken).digest('hex');let created=false;
 const publicConfig=fs.readFileSync(path.join(root,'src/lib/firebase.ts'),'utf8');
 const apiKey=publicConfig.match(/VITE_FIREBASE_API_KEY\s*\|\|\s*"([^"]+)"/)?.[1];if(!apiKey)throw Error('Public Firebase config unavailable');
 try{
  check('push remains disabled',(await db.doc('funded_notifications_config/current').get()).data()?.enabled!==true);
  check('MFA remains unactivated',(await db.doc('funded_mfa_rollout/current').get()).data()?.ready!==true);
  const password=crypto.randomBytes(24).toString('base64url'),email=uid+'@example.invalid';
  await admin.auth().createUser({uid,email,password,emailVerified:true});created=true;
  await db.doc('users/'+uid).set({displayName:'Disposable iOS QA',email,twoFactorEnabled:false,qaRun:uid});
  const signIn=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const identity=await signIn.json();check('real Firebase email sign-in succeeds',signIn.ok&&!!identity.idToken);
  const call=async(name,data,token=identity.idToken)=>{const r=await fetch('https://us-central1-fynx-c7a28.cloudfunctions.net/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data})});const d=await r.json();return {status:r.status,value:d.result,error:d.error?.status}};
  check('unauthenticated reads rejected',(await call('fundedAccountInsights',{challengeId,phase:1},null)).error==='UNAUTHENTICATED');
  await db.doc('challenges/'+challengeId).set({userId:uid,currentPhase:1,currency:'USD',status:'qa_initial',qaRun:uid});
  const empty=await call('fundedAccountInsights',{challengeId,phase:1});check('owned missing history is explicit',empty.value?.status==='awaiting_history'&&empty.value?.snapshot===null);
  check('unknown account is inaccessible',(await call('fundedAccountInsights',{challengeId:'nonexistent-'+uid,phase:1})).error==='NOT_FOUND');
  const now=Date.now(),start=new Date(now-300000).toISOString(),through=new Date(now-1000).toISOString();
  const {ruleSnapshot}=require('../functions/lib/fundedPolicy');const rule=ruleSnapshot({program:'1-phase',phase:1,starting_balance:'10000',currency:'USD'});
  const policy={policy_version:'fynx-funded-v1',program:'1-phase',phase:1,starting_balance:'10000',currency:'USD',start_timestamp:start,
   agreement:{verified:true,reference:'SYNTHETIC-QA',document_sha256:'a'.repeat(64),accepted_at:start,reviewed_at:start,reviewed_by:'synthetic-qa',policy_version:'fynx-funded-v1',rule_snapshot:rule},
   coverage:{complete:true,pagination_complete:true,equity_complete:true,source_reference:'SYNTHETIC-QA-NOT-BROKER',adapter_version:'qa',reviewed_by:'synthetic-qa',reviewed_at:through,source_sha256:'b'.repeat(64),from:start,through,event_count:1,source_sequence_start:1,source_sequence_end:1,account_id:uid,phase_reference:'SYNTHETIC-QA:phase:1'}};
  await db.doc('rule_events/'+eventId).set({userId:uid,challengeId,sequence:1,timestamp:through,event_type:'equity_mark',open_position_count:1,unrealized_pnl_after:'-200',account_id:uid,phase_reference:'SYNTHETIC-QA:phase:1',source_sequence:1,source_event_id:'qa-mark',broker_balance:'10000',broker_equity:'9800',qaRun:uid});
  await db.doc('challenges/'+challengeId).update({phase:'1-phase',accountSize:10000,brokerAccountId:uid,rulePolicyVersion:'fynx-funded-v1',rulePolicy:policy,status:'qa_updated'});
  const insights=await call('fundedAccountInsights',{challengeId,phase:1});check('deployed callable reconciles synthetic independent equity',insights.value?.snapshot?.equity==='9800'&&insights.value?.snapshot?.remaining==='200'&&insights.value?.authorizesTrading===false);
  await db.doc('rule_events/'+eventId).update({broker_equity:'9999'});const mismatch=await call('fundedAccountInsights',{challengeId,phase:1});check('mismatched equity withheld',mismatch.value?.status==='review_required'&&mismatch.value?.snapshot===null);
  check('push registration requires explicit opt-in',(await call('fundedNotifications',{action:'register',token:fakeToken,enabled:false})).error==='INVALID_ARGUMENT');
  check('test token registration accepted',(await call('fundedNotifications',{action:'register',token:fakeToken,enabled:true})).value?.saved===true);
  let inbox;for(let attempt=0;attempt<12;attempt++){inbox=await call('fundedNotifications',{action:'inbox'});if(inbox.value?.items?.length)break;await new Promise(r=>setTimeout(r,2000));}
  check('real Firestore trigger creates a private inbox notice',inbox.value?.items?.some(x=>x.accountID===challengeId));
  check('background sending is still disabled',inbox.value?.pushAvailable===false);
  const ids=inbox.value.items.map(x=>x.id);await call('fundedNotifications',{action:'read',ids});
  check('read status persists',(await call('fundedNotifications',{action:'inbox'})).value?.items?.every(x=>x.read));
  const exported=await call('fundedPrivacy',{action:'export'});
  check('privacy export contains inbox but excludes push token',exported.value?.documents?.some(x=>x.path.includes('/items/'))&&!JSON.stringify(exported.value).includes(fakeToken));
  await call('fundedNotifications',{action:'unregister',token:fakeToken});check('unregistration removes token',!(await db.doc('funded_push_devices/'+tokenID).get()).exists);
  await db.doc('users/'+uid).update({twoFactorEnabled:true});check('unactivated MFA customer fails closed',(await call('fundedAccountInsights',{challengeId,phase:1})).error==='FAILED_PRECONDITION');
  report.complete=true;
 }finally{
  try{
   await db.doc('challenges/'+challengeId).delete();await db.doc('rule_events/'+eventId).delete();await db.doc('funded_push_devices/'+tokenID).delete();
   await db.recursiveDelete(db.doc('funded_notice_inboxes/'+uid));await db.recursiveDelete(db.doc('users/'+uid));
   if(created)await admin.auth().deleteUser(uid);
   report.cleanup=true;
  }finally{fs.rmSync(temp,{recursive:true,force:true});fs.mkdirSync(path.join(root,'docs/ios-completion-2026-10-11'),{recursive:true});fs.writeFileSync(path.join(root,'docs/ios-completion-2026-10-11/live-smoke.json'),JSON.stringify(report,null,2)+'\n');}
 }
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message?.startsWith('Check failed:')?e.message:'Live smoke failed; inspect sanitized evidence.');process.exitCode=1});
