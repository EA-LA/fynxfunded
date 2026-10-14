#!/usr/bin/env node
// Add missing native fulfillment events to the existing TEST endpoint only. Never opens live purchases.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
async function main(){
 const cli=path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'firebase-tools/lib');const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/configstore/firebase-tools.json')));
 const token=(await require(cli+'/auth').getAccessToken(config.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform'])).access_token;
 const response=await fetch('https://secretmanager.googleapis.com/v1/projects/fynx-c7a28/secrets/STRIPE_SECRET_KEY/versions/1:access',{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw Error('Secret access unavailable');
 const key=Buffer.from((await response.json()).payload.data,'base64').toString().trim();if(!/^(sk|rk)_test_/.test(key))throw Error('This command accepts TEST mode only');
 const headers={Authorization:'Bearer '+key};const endpoint='https://us-central1-fynx-c7a28.cloudfunctions.net/stripeWebhook';
 const listResponse=await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100',{headers}),list=await listResponse.json();
 if(!listResponse.ok||list.has_more)throw Error('Complete endpoint inventory required');const matches=list.data.filter(x=>x.url===endpoint&&x.livemode===false);if(matches.length!==1)throw Error('Expected one existing test endpoint');
 const current=matches[0],required=['checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded'];
 const events=current.enabled_events.includes('*')?['*']:[...new Set([...current.enabled_events,...required])];
 const report={checkedAt:new Date().toISOString(),mode:'test only',url:endpoint,before:current.enabled_events,after:events,changed:false,livePaymentsEnabled:false};
 if(process.argv.includes('--apply')&&events.length!==current.enabled_events.length){
  const form=new URLSearchParams();for(const event of events)form.append('enabled_events[]',event);
  const update=await fetch('https://api.stripe.com/v1/webhook_endpoints/'+current.id,{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:form});if(!update.ok)throw Error('Endpoint update failed');report.changed=true;
 }
 const verified=await fetch('https://api.stripe.com/v1/webhook_endpoints/'+current.id,{headers});const value=await verified.json();report.verified=verified.ok&&value.livemode===false&&value.status==='enabled'&&(value.enabled_events.includes('*')||required.every(x=>value.enabled_events.includes(x)));
 fs.writeFileSync(path.join(__dirname,'../docs/ios-completion-2026-10-12/test-webhook-configuration.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Test webhook configuration unavailable; no secrets logged.');process.exitCode=1});
