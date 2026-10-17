#!/usr/bin/env node
// Read-only, sanitized readiness inventory. Never prints credential values or customer data.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const admin = require('../functions/node_modules/firebase-admin');
async function main() {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funded-readiness-'));
 const file = path.join(dir, 'adc.json');
 const outputIndex = process.argv.indexOf('--output');
 const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1] || '') : path.join(__dirname,'../docs/ios-completion-2026-10-12/readiness.json');
 if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('--output needs a file path');
 const report = {checkedAt:new Date().toISOString(), mode:'read-only', functions:{}, checks:{}};
 try {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
   const cli = path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'firebase-tools/lib');
   const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/configstore/firebase-tools.json')));
   const api = require(path.join(cli, 'api'));
   fs.writeFileSync(file, JSON.stringify({type:'authorized_user', client_id:api.clientId(), client_secret:api.clientSecret(), refresh_token:config.tokens.refresh_token}), {mode:0o600});
   process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
  }
  const credential = admin.credential.applicationDefault();
  const token = (await credential.getAccessToken()).access_token;
  admin.initializeApp({projectId:'fynx-c7a28',credential});
  const get = async (url,method='GET') => {const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token}}); const raw=await r.text();let data={};try{data=JSON.parse(raw);}catch{}return {httpStatus:r.status,data};};
  for(const name of ['fundedMfa','fundedMobileCheckout','fundedMobileIdentity','stripeWebhook','stripeIdentityWebhook']) {
   const r = await get('https://cloudfunctions.googleapis.com/v2/projects/fynx-c7a28/locations/us-central1/functions/'+name);
   report.functions[name] = r.httpStatus===200 ? {state:r.data.state, serviceAccount:r.data.serviceConfig?.serviceAccountEmail, runtime:r.data.buildConfig?.runtime, updatedAt:r.data.updateTime, secrets:(r.data.serviceConfig?.secretEnvironmentVariables??[]).map(x=>({name:x.key,version:x.version})), purchasesApproved:r.data.serviceConfig?.environmentVariables?.FYNX_FUNDED_PURCHASES_APPROVED==='true', publicKeyMode:/^pk_live_/.test(r.data.serviceConfig?.environmentVariables?.STRIPE_PUBLISHABLE_KEY??'')?'live':/^pk_test_/.test(r.data.serviceConfig?.environmentVariables?.STRIPE_PUBLISHABLE_KEY??'')?'test':'unconfigured'} : {httpStatus:r.httpStatus, code:r.data.error?.status};
  }
  report.providers = {};
  const accounts = {};
  for (const [label,fn,secretName,webhookName] of [['payments','fundedMobileCheckout','STRIPE_SECRET_KEY','stripeWebhook'],['identity','fundedMobileIdentity','STRIPE_IDENTITY_SECRET_KEY','stripeIdentityWebhook']]) {
    const binding=report.functions[fn].secrets?.find(x=>x.name===secretName);
    if(!binding){report.providers[label]={configured:false};continue;}
    const value=await get(`https://secretmanager.googleapis.com/v1/projects/fynx-c7a28/secrets/${secretName}/versions/${binding.version}:access`);
    if(value.httpStatus!==200){report.providers[label]={secretReadable:false,httpStatus:value.httpStatus};continue;}
    const key=Buffer.from(value.data.payload.data,'base64').toString('utf8').trim();
    const mode=/^(sk|rk)_live_/.test(key)?'live':/^(sk|rk)_test_/.test(key)?'test':'unconfigured';
    report.providers[label]={mode};if(mode==='unconfigured')continue;
    const headers={Authorization:'Bearer '+key};
    const accountResponse=await fetch('https://api.stripe.com/v1/account',{headers});const account=await accountResponse.json();
    if(accountResponse.ok){accounts[label]=account.id;report.providers[label].account={chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,detailsSubmitted:account.details_submitted};}
    else report.providers[label].account={httpStatus:accountResponse.status};
    const response=await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100',{headers});const hooks=await response.json();
    report.providers[label].webhooks=response.ok?(hooks.data??[]).filter(x=>x.url.includes('/'+webhookName)||x.url.toLowerCase().includes(webhookName.toLowerCase()+'-')).map(x=>({url:x.url,status:x.status,events:x.enabled_events,live:x.livemode})):{httpStatus:response.status};
    report.providers[label].webhookInventoryComplete=response.ok&&hooks.has_more===false;
  }
  report.providers.sameStripeAccount=accounts.payments&&accounts.identity?accounts.payments===accounts.identity:null;
  const sa=report.functions.fundedMfa.serviceAccount;
  if(sa) {
   const r=await get('https://iam.googleapis.com/v1/projects/-/serviceAccounts/'+encodeURIComponent(sa)+':getIamPolicy','POST');
   report.signingIAM={serviceAccount:sa,httpStatus:r.httpStatus,code:r.data.error?.status,bindings:r.httpStatus===200?(r.data.bindings??[]).filter(x=>(x.members??[]).includes('serviceAccount:'+sa)).map(x=>({role:x.role,conditional:!!x.condition})):undefined,runtimeSigningTested:false};
  }
  const db=admin.firestore();
  for(const name of ['accounts','rule_events','challenges','contracts','funded_memberships']) {
   try{report.checks[name]={count:(await db.collection(name).count().get()).data().count};}catch{report.checks[name]={unverified:true};}
  }
  for(const name of ['funded_mfa_rollout/current','funded_release/current','funded_legal_releases/current','funded_notifications_config/current']) {
   const s=await db.doc(name).get();report.checks[name]={exists:s.exists,ready:s.data()?.ready===true,approved:s.data()?.status==='approved',enabled:s.data()?.enabled===true};
  }
 } catch(e) {report.error={code:typeof e.code==='string'?e.code:'AUTH_OR_NETWORK_UNAVAILABLE'};process.exitCode=1;}
 finally {fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Readiness audit failed; credentials were not logged.');process.exitCode=1;});
