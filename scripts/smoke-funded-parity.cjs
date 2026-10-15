// Disposable authenticated service checks. No payments, broker creation, email or trading.
const admin=require('../functions/node_modules/firebase-admin'),crypto=require('node:crypto'),fs=require('node:fs');
async function main(){
 admin.initializeApp({projectId:'fynx-c7a28'});const db=admin.firestore(),uid='funded-parity-qa-'+crypto.randomBytes(10).toString('hex'),email=uid+'@example.invalid',password=crypto.randomBytes(32).toString('base64url');const results=[]; const responses=[];
 const api='https://us-central1-fynx-c7a28.cloudfunctions.net/';
 async function call(name,data,token){const response=await fetch(api+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data})});const body=await response.json();responses.push({name,status:response.status,error:body.error?.status,message:body.error?.message,accounts:body.result?.accounts?.length});return {status:response.status,body};}
 const check=(name,pass)=>{if(!pass)throw Error(name);results.push({name,passed:true});};
 try {
  await admin.auth().createUser({uid,email,password,emailVerified:true});await db.doc('users/'+uid).set({email,twoFactorEnabled:false,qaRun:uid});
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyBqBeQVVD46uUaYDZf9EX-VyTpQpYIm7aI',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});const identity=await response.json();if(!identity.idToken)throw Error('QA sign-in failed.');const token=identity.idToken;
  check('Unauthenticated order status denied',(await call('fundedOrderStatus',{orderId:uid})).status===401);
  check('Unowned or missing order does not disclose data',(await call('fundedOrderStatus',{orderId:'does-not-belong-to-qa'},token)).status===404);
  check('Invalid reference rejected',(await call('fundedOrderStatus',{orderId:'../users'},token)).status===400);
  await db.doc('orders/'+uid).set({userId:uid,status:'paid',challengeId:uid,qaRun:uid});
  check('Recorded payment without account remains pending',(await call('fundedOrderStatus',{orderId:uid},token)).body.result?.state==='account_pending');
  await db.doc('challenges/'+uid).set({userId:uid,orderId:uid,status:'active',provisioningStatus:'failed',qaRun:uid});
  check('Failed account setup preserves payment status',(await call('fundedOrderStatus',{orderId:uid},token)).body.result?.state==='provisioning_failed');
  await db.doc('orders/'+uid).update({status:'refunded'});check('Refund overrides setup state',(await call('fundedOrderStatus',{orderId:uid},token)).body.result?.state==='refunded');
  check('Metadata returns only owned accounts',(await call('fundedTradingAccess',{action:'metadata'},token)).body.result?.accounts?.length===0);
  check('Unowned credential request denied',(await call('fundedTradingAccess',{action:'reveal',accountId:'unowned',challengeId:uid},token)).status===404);
  check('Unauthenticated credential request denied',(await call('fundedTradingAccess',{action:'metadata'})).status===401);
  const {credentialKey}=require('./funded-credential-key.cjs'),{sealCredential}=require('../functions/lib/fundedCredentialVault');
  const key=await credentialKey(),secret='synthetic-password-'+crypto.randomBytes(8).toString('hex');
  await db.doc('orders/'+uid).update({status:'paid'});await db.doc('challenges/'+uid).update({brokerAccountId:uid,provisioningStatus:'ready'});
  await db.doc('funded_account_secrets/'+uid).set({...sealCredential(secret,{userId:uid,challengeId:uid,accountId:uid},key),qaRun:uid});
  await db.doc('accounts/'+uid).set({userId:uid,challengeId:uid,status:'active',provisioningStatus:'ready',providerConfirmedAt:new Date().toISOString(),providerReference:'SYNTHETIC-NOT-PROVIDER',platform:'Synthetic QA',server:'simulated',login:'qa',environment:'simulated',qaRun:uid});
  check('Synthetic confirmed fixture shows ready',(await call('fundedOrderStatus',{orderId:uid},token)).body.result?.accountReady===true);
  const metadata=(await call('fundedTradingAccess',{action:'metadata'},token)).body.result;
  check('Metadata excludes plaintext and encrypted secrets',metadata?.accounts?.length===1&&!JSON.stringify(metadata).includes(secret)&&!JSON.stringify(metadata).includes('ciphertext'));
  const reveal=(await call('fundedTradingAccess',{action:'reveal',accountId:uid,challengeId:uid},token)).body.result;
  check('Deployed vault decrypts only for its owning session',reveal?.password===secret&&reveal?.userId===uid);
  await db.doc('orders/'+uid).update({status:'refunded'});
  check('Refund immediately blocks credential reveal',(await call('fundedTradingAccess',{action:'reveal',accountId:uid,challengeId:uid},token)).status===400);

 } finally {
  for(const name of ['orders','challenges','accounts','funded_account_secrets'])await db.doc(name+'/'+uid).delete();await db.recursiveDelete(db.doc('users/'+uid));await db.recursiveDelete(db.doc('funded_notice_inboxes/'+uid));for(const name of ['funded_credential_access','credential_deliveries'])for(const row of (await db.collection(name).where('userId','==',uid).get()).docs)await row.ref.delete();await admin.auth().deleteUser(uid).catch(()=>{});
  fs.writeFileSync('docs/launch-2026-10-14/live-services.json',JSON.stringify({checkedAt:new Date().toISOString(),synthetic:true,providerProof:false,cleanedUp:true,checks:results,responses},null,2)+'\n');
 }
 console.log(results.length+' deployed-service checks passed; QA identity and fixtures removed.');
}
main().catch(()=>{console.error('A deployed-service check failed. See the redacted evidence; no credentials logged.');process.exitCode=1;});
