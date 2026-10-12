import { beforeEach, afterEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ records: new Map<string, any>(), commitFails: false, paused: true, stripe: vi.fn() }));
vi.mock("firebase-admin", () => {
  const ref = (path: string): any => ({path,id:path.split('/').at(-1),get:async()=>({exists:fake.records.has(path),data:()=>fake.records.get(path)})});
  const db={doc:ref,runTransaction:async(fn:any)=>{
    const writes:any[]=[];const result=await fn({get:(r:any)=>r.get(),set:(r:any,v:any)=>writes.push([r.path,v,false]),create:(r:any,v:any)=>writes.push([r.path,v,true])});
    if(fake.commitFails)throw Error('commit failed');
    for(const [p,,create] of writes)if(create&&fake.records.has(p))throw Error('already exists');
    for(const [p,v] of writes)fake.records.set(p,{...fake.records.get(p),...v});return result;
  }};
  return {firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>"server-time"}})};
});
vi.mock("firebase-functions/v2/https",()=>({onCall:(_:any,handler:any)=>handler,HttpsError:class extends Error{constructor(public code:string,message:string){super(message)}}}));
vi.mock("firebase-functions/params",()=>({defineSecret:()=>({value:()=>"sk_test_fixture"}),defineString:()=>({value:()=>"pk_test_fixture"})}));
vi.mock("../src/nativeCustomer",()=>({nativeCustomer:async(r:any)=>r.auth.uid}));
vi.mock("../src/stripe/paymentAvailability",()=>({paymentsPaused:()=>fake.paused}));
vi.mock("stripe",()=>({default:class{paymentIntents={create:fake.stripe,retrieve:fake.stripe}}}));
import { fulfillNativePayment } from "../src/nativePaymentFulfillment";
import { fundedMobileCheckout } from "../src/nativeCheckout";
import { build } from "../src/purchasedAgreement";
import { VERSION } from "../src/fundedPolicy";
import { documentHash, recordLegalAcceptance, type LegalRelease } from "../src/fundedLegal";
const release:LegalRelease={version:'fixture-v1',status:'approved',approvedBy:'fixture-only',approvedAt:'2026-01-01T00:00:00Z',effectiveAt:'2026-01-01T00:00:00Z',operator:{name:'Fixture',country:'US',contact:'qa@example.invalid'},billing:'one_time',documents:(["terms","privacy","refund","risk"] as const).map(kind=>({kind,version:'fixture-v1',url:`https://www.fynxfunded.com/${kind}`,text:kind,sha256:documentHash(kind)}))};
const consent={accepted:true,version:release.version,documentHashes:Object.fromEntries(release.documents.map(d=>[d.kind,d.sha256]))};
const rules=()=>build({uid:'u',program:'2-phase',starting_balance:'10000',accepted:true,accepted_version:VERSION});
const attempt=()=>({userId:'u',accountSize:10000,amountCents:7900,phase:'2',size:'10k',style:'normal',rules:rules(),createdAt:Date.now(),legalAcceptance:recordLegalAcceptance(release,consent,'u',new Date().toISOString(),'authenticated_ios_checkout')});
const intent=():any=>({id:'pi_native',status:'succeeded',livemode:false,amount:7900,amount_received:7900,currency:'usd',metadata:{channel:'ios_native',userId:'u',native_checkout_attempt:'u_attempt',phase:'2',accountSize:'10000',style:'normal',rule_policy_version:VERSION,rule_document_sha256:rules().document_sha256,legal_version:release.version}});
const call=(data:any)=>(fundedMobileCheckout as any)({auth:{uid:'u',token:{email:'qa@example.invalid'}},data});
beforeEach(()=>{fake.records.clear();fake.commitFails=false;fake.paused=true;fake.stripe.mockReset();vi.stubEnv('FUNCTIONS_EMULATOR','true');vi.stubEnv('FYNX_FUNDED_PURCHASES_APPROVED','true');fake.records.set('native_checkout_attempts/u_attempt',attempt());});
afterEach(()=>vi.unstubAllEnvs());
it('fulfills a native payment even if the webhook precedes the order write',async()=>{
 await fulfillNativePayment(intent(),'evt_one');expect(fake.records.get('orders/pi_native')).toMatchObject({status:'paid',fulfillmentStatus:'complete',channel:'ios_native'});
 expect(fake.records.get('challenges/pi_native')).toMatchObject({currentPhase:1,brokerAccountId:null,progressionMode:'manual'});
});
it('duplicate events cannot reset phase, broker binding, breach or refund status',async()=>{
 await fulfillNativePayment(intent(),'evt_one');const challenge={...fake.records.get('challenges/pi_native'),currentPhase:2,status:'failed',brokerAccountId:'broker',breachRecorded:true};fake.records.set('challenges/pi_native',challenge);
 fake.records.get('orders/pi_native').status='refunded';await fulfillNativePayment(intent(),'evt_two');expect(fake.records.get('challenges/pi_native')).toEqual(challenge);expect(fake.records.get('orders/pi_native').status).toBe('refunded');
});
it.each(['owner','amount','received','currency','rules','legal','intent','style'])('rejects mismatched %s without partial fulfillment',async(field)=>{
 const paid=intent();if(field==='owner')paid.metadata.userId='other';if(field==='amount')paid.amount=1;if(field==='received')paid.amount_received=1;if(field==='currency')paid.currency='eur';if(field==='rules')paid.metadata.rule_document_sha256='bad';if(field==='legal')paid.metadata.legal_version='bad';if(field==='intent')fake.records.get('native_checkout_attempts/u_attempt').intentId='pi_other';if(field==='style')paid.metadata.style='swing';
 await expect(fulfillNativePayment(paid,'evt_one')).rejects.toThrow();expect(fake.records.size).toBe(1);
});
it('production ignores test-mode payments and non-native intents',async()=>{vi.stubEnv('FUNCTIONS_EMULATOR','false');await fulfillNativePayment(intent(),'evt_one');expect(fake.records.size).toBe(1);vi.stubEnv('FUNCTIONS_EMULATOR','true');const p=intent();p.metadata.channel='web';await fulfillNativePayment(p,'evt_one');expect(fake.records.size).toBe(1);});
it('failed transaction cannot create a paid order or challenge',async()=>{fake.commitFails=true;await expect(fulfillNativePayment(intent(),'evt_one')).rejects.toThrow('commit');expect(fake.records.size).toBe(1);});
it('catalog remains closed without approved legal text even with provider flags',async()=>{fake.paused=false;const result=await call({action:'catalog'});expect(result.available).toBe(false);expect(result.legal).toBeNull();});
it('purchase pause is enforced before a provider call',async()=>{await expect(call({action:'create'})).rejects.toMatchObject({code:'failed-precondition'});expect(fake.stripe).not.toHaveBeenCalled();});
it('requires actual legal consent before reserving or charging',async()=>{fake.paused=false;fake.records.set('funded_legal_releases/current',release);await expect(call({action:'create',size:'10k',phase:'2',style:'normal',requestId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',acceptRules:true,rulePolicyVersion:VERSION})).rejects.toThrow(/accept/);expect(fake.stripe).not.toHaveBeenCalled();});
it('records immutable rules and legal snapshots in a native reservation',async()=>{
 fake.paused=false;fake.records.set('funded_legal_releases/current',release);fake.stripe.mockResolvedValue({...intent(),client_secret:'test-only'});
 await call({action:'create',size:'10k',phase:'2',style:'normal',requestId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',acceptRules:true,rulePolicyVersion:VERSION,legalAcceptance:consent});
 expect(fake.stripe.mock.calls[0][0].metadata.native_checkout_attempt).toBe('u_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');expect(fake.records.get('orders/pi_native').legalAcceptance.source).toBe('authenticated_ios_checkout');
});
