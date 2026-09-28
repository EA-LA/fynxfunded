import { describe, expect, it } from 'vitest';
import { emailActionRedirect } from '../lib/email-action-routing';
const query=(mode:string,continueUrl='')=>new URLSearchParams({mode,continueUrl,oobCode:'disposable-test-code',apiKey:'public-key',lang:'en'}).toString();
describe('shared auth email routing',()=>{
 for(const mode of ['resetPassword','verifyEmail','recoverEmail']) it('routes Finance '+mode+' to Finance',()=>{
  const url=new URL(emailActionRedirect(query(mode,'https://www.fynxfinanceworld.com/auth/login.html'))!);
  expect(url.origin).toBe('https://www.fynxfinanceworld.com');expect(url.pathname).toBe('/auth/action.html');expect(url.searchParams.get('mode')).toBe(mode);expect(url.searchParams.get('oobCode')).toBe('disposable-test-code');
 });
 it('keeps new and old Funded password resets on Funded',()=>{
  expect(emailActionRedirect(query('resetPassword'))).toBeNull();expect(emailActionRedirect(query('resetPassword','https://fynxfunded.com/reset-password'))).toBeNull();
 });
 it('uses the supported hosted handler for non-reset Funded actions',()=>{
  const url=new URL(emailActionRedirect(query('verifyEmail'))!);expect(url.origin).toBe('https://fynx-c7a28.firebaseapp.com');expect(url.searchParams.get('continueUrl')).toBe('https://fynxfunded.com/login');
 });
 it('never sends action codes to untrusted or lookalike origins',()=>{
  for(const origin of ['https://fynxfinanceworld.com.attacker.example','https://fynxfinanceworld.com@attacker.example','http://fynxfinanceworld.com','javascript:alert(1)'])expect(emailActionRedirect(query('resetPassword',origin))).toBeNull();
 });
 it('does not redirect incomplete links',()=>expect(emailActionRedirect('mode=resetPassword')).toBeNull());
});
