import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { orderLifecycle, confirmedAccount, tradingLink } from '../src/fundedProvisioningPolicy';
import { sealCredential, openCredential } from '../src/fundedCredentialVault';
import { accountReadyMessage } from '../src/credentialDelivery';
const ready = { provisioningStatus: 'ready', providerConfirmedAt: new Date(Date.now()-1000).toISOString(), providerReference: 'provider-proof', platform: 'provider', server: 'demo', login: '123', environment: 'simulated', status: 'active' };
it('never treats payment or a bare account ID as provider confirmation', () => {
 expect(orderLifecycle({status:'paid'}).state).toBe('account_pending');
 expect(orderLifecycle({status:'paid'}, {status:'active'}, {status:'active'}).accountReady).toBe(false);
 expect(orderLifecycle({status:'paid'}, {status:'active'},ready).accountReady).toBe(true);
});
it('represents failed setup separately from failed payment and refund', () => {
 expect(orderLifecycle({status:'paid'},{provisioningStatus:'failed'})).toMatchObject({state:'provisioning_failed',paymentConfirmed:true,accountReady:false});
 expect(orderLifecycle({status:'failed'},undefined,ready).accountReady).toBe(false);
 expect(orderLifecycle({status:'refunded'},{status:'active'},ready).state).toBe('refunded');
});
it('closed, suspended and breached accounts never become ready', () => {
 for(const status of ['closed','suspended','disabled'])expect(orderLifecycle({status:'paid'},{status:'active'},{...ready,status}).state).toBe('account_unavailable');
 expect(orderLifecycle({status:'paid'},{status:'failed'},ready).accountReady).toBe(false);
});
it('rejects unknown payment states and invalid/future provider confirmation', () => {
 expect(orderLifecycle({status:'unexpected'}).state).toBe('review_required');
 expect(confirmedAccount({...ready,providerConfirmedAt:'bad'})).toBe(false);
 expect(confirmedAccount({...ready,providerConfirmedAt:new Date(Date.now()+60000).toISOString()})).toBe(false);
});
it('blocks token-bearing and non-HTTPS platform links',()=>{
 for(const url of ['javascript:alert(1)','http://example.com','https://user:pass@example.com','https://example.com?token=abc','https://example.com#token'])expect(tradingLink(url)).toBeNull();
 expect(tradingLink('https://example.com/trade')).toBe('https://example.com/trade');
});
it('encrypts credentials with fresh nonces and binds ciphertext to customer and account',()=>{
 const key=randomBytes(32).toString('base64'),binding={userId:'u',challengeId:'c',accountId:'a'};
 const a=sealCredential('sensitive-password',binding,key),b=sealCredential('sensitive-password',binding,key);
 expect(JSON.stringify(a)).not.toContain('sensitive-password');expect(a.iv).not.toBe(b.iv);
 expect(openCredential(a,binding,key)).toBe('sensitive-password');
 for(const field of ['userId','challengeId','accountId'])expect(()=>openCredential({...a,[field]:'other'},{...binding,[field]:'other'},key)).toThrow();
 expect(()=>openCredential({...a,tag:randomBytes(16).toString('base64')},binding,key)).toThrow();
 expect(()=>openCredential(a,binding,randomBytes(32).toString('base64'))).toThrow();
});
it('account-ready emails contain only an authenticated dashboard link',()=>{
 const m=accountReadyMessage('c');expect(m.text).toContain('https://www.fynxfunded.com/dashboard/accounts/c');expect(m.text).toContain('never sent by email');expect(m.html).not.toContain('Password</');
});
