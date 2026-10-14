#!/usr/bin/env node
// Default is read-only preview. Production execution needs a separately approved exact plan hash.
const fs=require('node:fs'),path=require('node:path'),admin=require('../functions/node_modules/firebase-admin');
const {previewPhaseTransition,executePhaseTransition}=require('../functions/lib/fundedPhaseTransition');
async function main(){
 const args=process.argv.slice(2),value=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
 if(!value('--plan')||!path.isAbsolute(value('--plan')))throw Error('Use an absolute --plan file path.');
 admin.initializeApp({projectId:'fynx-c7a28'});const db=admin.firestore();
 if(!args.includes('--execute')){
  if(!value('--challenge')||!value('--next-account'))throw Error('Preview requires --challenge and --next-account.');
  const preview=await previewPhaseTransition(db,value('--challenge'),value('--next-account'));
  fs.writeFileSync(value('--plan'),JSON.stringify(preview,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({mode:'review only',hash:preview.hash,fromPhase:preview.plan.fromPhase,toPhase:preview.plan.toPhase,eventCount:preview.plan.eventCount,authorizesTransition:false}));return;
 }
 const reviewed=JSON.parse(fs.readFileSync(value('--plan'),'utf8'));
 if(value('--approved-hash')!==reviewed.hash||!value('--reviewed-by'))throw Error('Execution needs the exact --approved-hash and --reviewed-by identity.');
 const result=await executePhaseTransition(db,reviewed.plan,reviewed.hash,value('--reviewed-by'));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
