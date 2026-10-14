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
 } finally {
  for(const name of ['orders','challenges'])await db.doc(name+'/'+uid).delete();await db.recursiveDelete(db.doc('users/'+uid));await admin.auth().deleteUser(uid).catch(()=>{});
  fs.writeFileSync('docs/launch-2026-10-14/live-services.json',JSON.stringify({checkedAt:new Date().toISOString(),synthetic:true,providerProof:false,cleanedUp:true,checks:results,responses},null,2)+'\n');
 }
 console.log(results.length+' deployed-service checks passed; QA identity and fixtures removed.');
}
main().catch(()=>{console.error('A deployed-service check failed. See the redacted evidence; no credentials logged.');process.exitCode=1;});
