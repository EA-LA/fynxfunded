#!/usr/bin/env node
// Exercises deployed MFA only for disposable QA identities. Never enables the global rollout.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const admin=require('../functions/node_modules/firebase-admin');
const {totp,codeHash}=require('../functions/lib/mfaPolicy');
const report={checkedAt:new Date().toISOString(),scope:'disposable synthetic MFA cohort; not a customer rollout',checks:[],cleanup:false,globalActivation:false};
const check=(name,ok)=>{report.checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
async function main(){
 if(!process.argv.includes('--run-production'))throw Error('Use --run-production explicitly.');
 const cli=path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'firebase-tools/lib');
 const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/configstore/firebase-tools.json'))),api=require(path.join(cli,'api'));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'funded-mfa-canary-')),adc=path.join(temp,'adc.json');
 fs.writeFileSync(adc,JSON.stringify({type:'authorized_user',client_id:api.clientId(),client_secret:api.clientSecret(),refresh_token:config.tokens.refresh_token}),{mode:0o600});process.env.GOOGLE_APPLICATION_CREDENTIALS=adc;
 admin.initializeApp({projectId:'fynx-c7a28'});const db=admin.firestore(),rollout=db.doc('funded_mfa_rollout/current'),uids=[],runId=crypto.randomUUID();let registered=false;
 const source=fs.readFileSync(path.join(__dirname,'../src/lib/firebase.ts'),'utf8'),key=source.match(/VITE_FIREBASE_API_KEY\s*\|\|\s*"([^"]+)"/)?.[1];
 const call=async(name,data,token)=>{const r=await fetch('https://us-central1-fynx-c7a28.cloudfunctions.net/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data})});const d=await r.json();return {status:r.status,data:d.result,error:d.error?.status,details:d.error?.details};};
 const identity=async(method,body)=>{const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+method+'?key='+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,returnSecureToken:true})});const d=await r.json();if(!r.ok||!d.idToken)throw Error('Firebase test sign-in failed');return d.idToken;};
 try{
  const initial=await rollout.get();check('Global customer MFA remains inactive',initial.data()?.ready!==true);check('No other QA cohort is active',!initial.data()?.qaRunId);
  for(let i=0;i<2;i++){
   const uid='funded-mfa-qa-'+crypto.randomBytes(10).toString('hex'),email=uid+'@example.invalid',password=crypto.randomBytes(24).toString('base64url');
   await admin.auth().createUser({uid,email,password,emailVerified:true});uids.push({uid,token:await identity('signInWithPassword',{email,password})});
   await db.doc('users/'+uid).set({userId:uid,email,twoFactorEnabled:false,qaRun:runId});
  }
  const first=uids[0],second=uids[1];
  await db.runTransaction(async tx=>{const now=(await tx.get(rollout)).data();if(now?.ready===true||now?.qaRunId)throw Error('Rollout changed');tx.set(rollout,{qaRunId:runId,qaUids:uids.map(x=>x.uid),qaExpiresAt:Date.now()+1800000},{merge:true});});registered=true;
  check('Canary first-factor status works',(await call('fundedMfa',{action:'status'},first.token)).data?.required===false);
  const setup=await call('fundedMfa',{action:'enrollStart'},first.token);check('Server enrollment returns setup for the QA identity',typeof setup.data?.secret==='string');
  check('Wrong enrollment code denied',(await call('fundedMfa',{action:'enrollConfirm',code:'wrong'},first.token)).error==='PERMISSION_DENIED');
  const code=totp(setup.data.secret,Math.floor(Date.now()/30000));
  const confirmed=await call('fundedMfa',{action:'enrollConfirm',code},first.token);
  report.signing={tested:true,customTokenIssued:typeof confirmed.data?.customToken==='string',error:confirmed.error??null,details:confirmed.details??null};
  check('Runtime signs a real custom token',report.signing.customTokenIssued);
  const verified=await identity('signInWithCustomToken',{token:confirmed.data.customToken});
  check('Firebase exchanges the server-signed proof',(await call('fundedMfa',{action:'status'},verified)).data?.verified===true);
  check('Protected endpoint denies first factor',(await call('fundedPrivacy',{action:'status'},first.token)).error==='PERMISSION_DENIED');
  check('Protected endpoint accepts MFA proof',(await call('fundedPrivacy',{action:'status'},verified)).data?.scope==='FYNX Funded only');
  check('Authenticator replay denied',(await call('fundedMfa',{action:'verify',code},first.token)).error==='PERMISSION_DENIED');
  const recovery=await call('fundedMfa',{action:'recovery'},verified);check('Recovery codes generated',recovery.data?.codes?.length===10);
  const results=await Promise.all([call('fundedMfa',{action:'verify',code:recovery.data.codes[0]},first.token),call('fundedMfa',{action:'verify',code:recovery.data.codes[0]},first.token)]);
  check('Concurrent recovery use succeeds once',results.filter(x=>typeof x.data?.customToken==='string').length===1);
  await call('fundedMfa',{action:'logout'},verified);check('Logout invalidates this proof',(await call('fundedPrivacy',{action:'status'},verified)).error==='PERMISSION_DENIED');
  const recovered=await identity('signInWithCustomToken',{token:results.find(x=>x.data?.customToken).data.customToken});
  const claims=JSON.parse(Buffer.from(recovered.split('.')[1],'base64url').toString());
  await db.doc('funded_mfa_sessions/'+claims.funded_mfa).update({expiresAt:Date.now()-1});check('Expired proof denied by the server',(await call('fundedPrivacy',{action:'status'},recovered)).error==='PERMISSION_DENIED');
  const legacySecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';await db.doc('funded_mfa_private/'+second.uid).delete();
  await db.doc('users/'+second.uid).update({twoFactorEnabled:true});await db.doc(`users/${second.uid}/security/settings`).set({twoFactorEnabled:true,twoFactorSecret:legacySecret,backupCodeHashes:[codeHash('AAAA-BBBB-CCCC-DDDD')]});
  const migrated=await call('fundedMfa',{action:'status'},second.token);const publicState=(await db.doc(`users/${second.uid}/security/settings`).get()).data();
  check('Legacy factor migrates privately',migrated.data?.required===true&&!publicState.twoFactorSecret&&!publicState.backupCodeHashes);
  check('Migrated recovery code verifies',typeof (await call('fundedMfa',{action:'verify',code:'AAAA-BBBB-CCCC-DDDD'},second.token)).data?.customToken==='string');
  for(let i=0;i<5;i++)await call('fundedMfa',{action:'verify',code:'wrong'},second.token);
  check('Wrong-code lockout persists',(await call('fundedMfa',{action:'verify',code:'wrong'},second.token)).error==='RESOURCE_EXHAUSTED');
  report.complete=true;
 }catch(e){report.complete=false;report.failedCheck=report.checks.find(x=>!x.passed)?.name??'Canary setup or network';process.exitCode=1;}
 finally{
  try{
   if(registered)await db.runTransaction(async tx=>{const current=(await tx.get(rollout)).data();if(current?.qaRunId!==runId)throw Error('QA cohort ownership changed');tx.update(rollout,{qaRunId:admin.firestore.FieldValue.delete(),qaUids:admin.firestore.FieldValue.delete(),qaExpiresAt:admin.firestore.FieldValue.delete()});});
   for(const {uid} of uids){for(const name of ['funded_mfa_sessions']){const rows=await db.collection(name).where('uid','==',uid).get();for(const row of rows.docs)await row.ref.delete();}await db.doc('funded_mfa_private/'+uid).delete();await db.recursiveDelete(db.doc('users/'+uid));await admin.auth().deleteUser(uid);}
   report.cleanup=true;report.globalActivation=(await rollout.get()).data()?.ready===true;
  }catch{report.cleanup=false;process.exitCode=1;}
  fs.rmSync(temp,{recursive:true,force:true});fs.writeFileSync(path.join(__dirname,'../docs/ios-completion-2026-10-12/mfa-canary.json'),JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('MFA canary unavailable; no secrets logged.');process.exitCode=1});
