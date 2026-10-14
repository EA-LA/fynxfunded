const admin=require('../functions/node_modules/firebase-admin'),fs=require('node:fs');
async function main(){
 admin.initializeApp({projectId:'fynx-c7a28'});const token=(await admin.credential.applicationDefault().getAccessToken()).access_token,headers={Authorization:'Bearer '+token};
 const root='https://cloudfunctions.googleapis.com/v2/projects/fynx-c7a28/locations/us-central1/functions/';
 const report={checkedAt:new Date().toISOString(),functions:{}};
 for(const name of ['fundedOrderStatus','fundedTradingAccess','sendBrokerCredentialsEmail','stripeWebhook','fundedPrivacy','reconcileFundedOrders']){const r=await fetch(root+name,{headers});if(!r.ok)throw Error('Function inspection failed.');const d=await r.json();report.functions[name]={state:d.state,revision:d.serviceConfig?.revision,updatedAt:d.updateTime,source:d.buildConfig?.source?.storageSource};}
 const r=await fetch('https://cloudscheduler.googleapis.com/v1/projects/fynx-c7a28/locations/us-central1/jobs',{headers});if(!r.ok)throw Error('Schedule inspection failed.');const jobs=(await r.json()).jobs||[];const job=jobs.find(j=>j.name.includes('reconcileFundedOrders'));
 report.reconciliationSchedule=job?{name:job.name,state:job.state,schedule:job.schedule,timeZone:job.timeZone}:null;
 if(process.argv.includes('--run-reconciliation')){if(!job)throw Error('Schedule missing.');const run=await fetch('https://cloudscheduler.googleapis.com/v1/'+job.name+':run',{method:'POST',headers});if(!run.ok)throw Error('Reconciliation invocation failed.');report.reconciliationDispatched=true;}
 fs.writeFileSync('docs/launch-2026-10-14/deployed-services.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({functions:Object.fromEntries(Object.entries(report.functions).map(([k,v])=>[k,v.state])),schedule:report.reconciliationSchedule?.state,dispatched:report.reconciliationDispatched||false}));
}
main().catch(()=>{console.error('Deployment inspection failed.');process.exitCode=1;});
