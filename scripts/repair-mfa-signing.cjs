#!/usr/bin/env node
// Least-scope standard IAM binding: runtime account can sign as itself, not as other accounts.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
async function main(){
 const project='fynx-c7a28',sa='1011050657868-compute@developer.gserviceaccount.com';
 const cli=path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'firebase-tools/lib');
 const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.config/configstore/firebase-tools.json')));
 const token=(await require(path.join(cli,'auth')).getAccessToken(config.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform'])).access_token;
 const request=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Object.assign(Error('Google API operation failed'),{status:r.status,code:d.error?.status});return d;};
 const base='https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts/'+encodeURIComponent(sa);
 const report={checkedAt:new Date().toISOString(),runtimeServiceAccount:sa,scope:'This service account only; no project-wide role grant',changed:false};
 try{
  const service=await request('https://serviceusage.googleapis.com/v1/projects/1011050657868/services/iamcredentials.googleapis.com');report.iamCredentialsApi=service.state;
  const policy=await request(base+':getIamPolicy','POST');const member='serviceAccount:'+sa,role='roles/iam.serviceAccountTokenCreator';
  report.alreadyGranted=(policy.bindings??[]).some(b=>b.role===role&&!b.condition&&b.members?.includes(member));
  if(!report.alreadyGranted&&process.argv.includes('--apply')){
   const bindings=policy.bindings??[];const binding=bindings.find(b=>b.role===role&&!b.condition);
   if(binding)binding.members.push(member);else bindings.push({role,members:[member]});
   await request(base+':setIamPolicy','POST',{policy:{...policy,bindings}});report.changed=true;
  }
  const verified=await request(base+':getIamPolicy','POST');report.selfSigningRolePresent=(verified.bindings??[]).some(b=>b.role===role&&!b.condition&&b.members?.includes(member));
  report.rollback='Remove only the added self-member from roles/iam.serviceAccountTokenCreator on this service account if the MFA signer is retired. Preserve other bindings.';
 }catch(e){report.error={httpStatus:e.status,code:e.code??'UNAVAILABLE'};process.exitCode=1;}
 fs.writeFileSync(path.join(__dirname,'../docs/ios-completion-2026-10-12/mfa-signing-repair.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Signing configuration unavailable; no credentials logged.');process.exitCode=1});
