// In-memory transaction adapter. Exercises the real callable handler; no customer data or network.
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const adminPath = require.resolve('firebase-admin', {paths:[root]});
const docs = new Map(); let minted = []; let queue = Promise.resolve();
const REMOVE = Symbol('delete');
const copy = v => structuredClone(v);
const snap = path => ({exists:docs.has(path), data:()=>docs.has(path) ? copy(docs.get(path)) : undefined});
const write = (p,d,merge) => { const next=merge ? {...docs.get(p)} : {}; for(const [k,v] of Object.entries(d)) {if(v===REMOVE) delete next[k];else next[k]=v} docs.set(p,next); };
const db = {
 doc:p=>({path:p,get:async()=>snap(p),set:async(d,o)=>write(p,d,o?.merge),delete:async()=>docs.delete(p)}),
 runTransaction:fn=>{const run=queue.then(async()=>{const writes=[];const result=await fn({get:async r=>snap(r.path),set:(r,d,o)=>writes.push(()=>write(r.path,d,o?.merge)),delete:r=>writes.push(()=>docs.delete(r.path)),update:(r,d)=>writes.push(()=>write(r.path,d,true))});writes.forEach(f=>f());return result});queue=run.catch(()=>{});return run}
};
const firestore=()=>db;firestore.FieldValue={delete:()=>REMOVE,serverTimestamp:()=>Date.now()};firestore.Timestamp={fromMillis:n=>n};
let disabled=false,revoked=false;
const mock={firestore,auth:()=>({getUser:async()=>({disabled,tokensValidAfterTime:revoked ? new Date(Date.now()+60000).toISOString() : '1970-01-01T00:00:00Z'}),createCustomToken:async(uid,claims)=>{minted.push({uid,claims});return 'test-only-token'}})};
require.cache[adminPath]={id:adminPath,filename:adminPath,loaded:true,exports:mock};
const {fundedMfa,requireFundedMfa,mfaRolloutEnabled}=require(root+'/lib/fundedMfa.js');
const {totp,codeHash}=require(root+'/lib/mfaPolicy.js');
const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const req=(action,extra={},token={})=>({auth:{uid:'alice',token:{email_verified:true,email:'alice@example.invalid',auth_time:Math.floor(Date.now()/1000),...token}},data:{action,...extra}});
const call=(action,extra,token)=>fundedMfa.run(req(action,extra,token));
const rejects=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
let passed=0;async function test(name,fn){await fn();console.log('PASS',name);passed++}
(async()=>{
 await test('Unauthenticated and unverified email rejected',async()=>{await rejects(()=>fundedMfa.run({data:{action:'status'}}),'unauthenticated');await rejects(()=>call('status',{}, {email_verified:false}),'permission-denied')});
 await test('Paused rollout permits ordinary login without writes',async()=>{const before=docs.size;assert.deepEqual(await call('status'),{required:false,verified:true,version:'rollout-paused',expiresAt:null});assert.equal(docs.size,before);await rejects(()=>call('enrollStart'),'failed-precondition')});
 await test('Paused rollout never bypasses private or legacy factors',async()=>{for(const [path,data] of [['users/alice',{twoFactorEnabled:true}],['users/alice/security/settings',{twoFactorEnabled:true}],['funded_mfa_private/alice',{enabled:true}],['funded_mfa_private/alice',{}]]){docs.set(path,data);await rejects(()=>call('status'),'failed-precondition');docs.delete(path)}});
 await test('QA rollout is scoped and expires',async()=>{const uid='funded-mfa-qa-'+'a'.repeat(20),now=Date.now();assert.equal(mfaRolloutEnabled({qaUids:[uid],qaExpiresAt:now+60000},uid,now),true);assert.equal(mfaRolloutEnabled({qaUids:[uid],qaExpiresAt:now+60000},'alice',now),false);assert.equal(mfaRolloutEnabled({qaUids:[uid],qaExpiresAt:now-1},uid,now),false)});
 docs.set('funded_mfa_rollout/current',{ready:true});
 docs.set('users/alice',{twoFactorEnabled:true});docs.set('users/alice/security/settings',{twoFactorEnabled:true,twoFactorSecret:secret,backupCodeHashes:[codeHash('AAAA-BBBB-CCCC-DDDD')]});
 await test('Legacy seed migrated privately; status exposes no secret',async()=>{const s=await call('status');assert.equal(s.required,true);assert.equal(s.verified,false);assert.equal(s.secret,undefined);assert.equal(docs.get('users/alice/security/settings').twoFactorSecret,undefined);assert.equal(docs.get('users/alice/security/settings').backupCodeHashes,undefined);assert.equal(docs.get('funded_mfa_private/alice').secret,secret)});
 await test('Protected Admin SDK operation rejects first-factor session',()=>rejects(()=>requireFundedMfa(req('status')),'permission-denied'));
 await test('Wrong code increments persisted failures',async()=>{await rejects(()=>call('verify',{code:'invalid'}),'permission-denied');assert.equal(docs.get('funded_mfa_private/alice').failures,1)});
 let claim;
 await test('Authenticator issues session-local proof and unlocks server gate',async()=>{const s=await call('verify',{code:totp(secret,Math.floor(Date.now()/30000))});assert.equal(s.customToken,'test-only-token');claim=minted.at(-1).claims;assert.match(claim.funded_mfa,/^[a-f0-9]{64}$/);const status=await call('status',{},claim);assert.equal(status.verified,true);assert.ok(status.expiresAt>Date.now());await requireFundedMfa(req('status',{},claim))});
 await test('Authenticator replay denied',()=>rejects(()=>call('verify',{code:totp(secret,Math.floor(Date.now()/30000))}),'permission-denied'));
 await test('Concurrent recovery submissions succeed once',async()=>{const r=await Promise.allSettled([call('verify',{code:'AAAA-BBBB-CCCC-DDDD'}),call('verify',{code:'AAAA-BBBB-CCCC-DDDD'})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1)});
 await test('Old first-factor and revoked sessions denied',async()=>{await rejects(()=>call('verify',{code:'invalid'},{auth_time:1}),'unauthenticated');revoked=true;await rejects(()=>call('status'),'unauthenticated');revoked=false;disabled=true;await rejects(()=>call('status'),'unauthenticated');disabled=false});
 await test('Rate limit commits and prevents valid code during lockout',async()=>{const state=docs.get('funded_mfa_private/alice');state.failures=0;state.blockedUntil=0;state.windowStarted=Date.now();for(let i=0;i<5;i++)await rejects(()=>call('verify',{code:'wrong'}),i===4?'resource-exhausted':'permission-denied');assert.ok(state!==docs.get('funded_mfa_private/alice'));assert.ok(docs.get('funded_mfa_private/alice').blockedUntil>Date.now());await rejects(()=>call('verify',{code:totp(secret,Math.floor(Date.now()/30000)+1)}),'resource-exhausted')});
 await test('Recovery regeneration requires proof and stores only hashes',async()=>{await rejects(()=>call('recovery'),'permission-denied');const r=await call('recovery',{},claim);assert.equal(r.codes.length,10);assert.equal(docs.get('funded_mfa_private/alice').recoveryHashes[0],codeHash(r.codes[0]))});
 await test('Disable requires proof and invalidates version',async()=>{await rejects(()=>call('disable'),'permission-denied');const before=docs.get('funded_mfa_private/alice').version;await call('disable',{},claim);assert.equal(docs.get('funded_mfa_private/alice').enabled,false);assert.notEqual(docs.get('funded_mfa_private/alice').version,before)});
 await test('Enrollment checks server-held seed, mirrors only metadata',async()=>{const setup=await call('enrollStart');assert.ok(setup.secret);await rejects(()=>call('enrollConfirm',{code:'wrong'}),'permission-denied');await call('enrollConfirm',{code:totp(setup.secret,Math.floor(Date.now()/30000))});assert.equal(docs.get('funded_mfa_private/alice').enabled,true);assert.equal(docs.get('funded_mfa_private/alice').pendingSecret,undefined);assert.equal(docs.get('users/alice/security/settings').twoFactorEnabled,true);assert.equal((await call('status',{},claim)).verified,false)});
 await test('Logout revokes only the presented proof',async()=>{const latest=minted.at(-1).claims;assert.equal((await call('status',{},latest)).verified,true);await call('logout',{},latest);assert.equal((await call('status',{},latest)).verified,false)});
 console.log(`${passed} callable integration checks passed (mocked database/auth).`);
})().catch(e=>{console.error(e);process.exitCode=1});
