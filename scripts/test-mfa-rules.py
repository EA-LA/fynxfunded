import json,urllib.request,pathlib,sys,hashlib,datetime
w=pathlib.Path(__file__).resolve().parents[1]
base='/databases/(default)/documents/'
uid='alice';sid='a'*64
cases=[];names=[]
def case(name,expected,enabled=True,claim=None,grant=None,path='accounts/a',data=None,method='get',write=None):
 docs={base+'funded_mfa_private/alice':{'enabled':enabled,'version':'v1'}}
 if grant:docs[base+'funded_mfa_sessions/'+sid]=grant
 mocks=[]
 for p,d in docs.items():
  mocks += [{'function':'exists','args':[{'exactValue':p}],'result':{'value':True}}, {'function':'get','args':[{'exactValue':p}],'result':{'value':{'data':d}}}]
 mocks += [{'function':'exists','args':[{'anyValue':{}}],'result':{'value':False}}]
 token={'email_verified':True,'email':'alice@example.invalid','admin':False}
 if claim:token['funded_mfa']=claim
 cases.append({'expectation':expected,'request':{'path':base+path,'method':method,'auth':{'uid':uid,'token':token},'time':'2026-09-28T06:00:00Z'},'resource':{'data':data or {'userId':uid}},'functionMocks':mocks,'expressionReportLevel':'VISITED'})
 if write is not None: cases[-1]['request']['resource']={'data':write}
 names.append(name)
case('Unverified MFA cannot read account','DENY')
case('Non-MFA owner can read account','ALLOW',enabled=False)
case('Private seed never client-readable','DENY',path='funded_mfa_private/alice',data={'secret':'FAKE_TEST_ONLY'})
case('Valid proof reads account','ALLOW',claim=sid,grant={'uid':uid,'version':'v1','expiresAt':1790607600000})
case('Expired proof denied','DENY',claim=sid,grant={'uid':uid,'version':'v1','expiresAt':1})
case('Another user proof denied','DENY',claim=sid,grant={'uid':'bob','version':'v1','expiresAt':1790607600000})
case('Old version proof denied','DENY',claim=sid,grant={'uid':uid,'version':'old','expiresAt':1790607600000})
case('Unverified profile protected','DENY',path='users/alice')
case('Unverified KYC profile protected','DENY',path='kyc_profiles/alice')
case('Cannot disable own factor through root document','DENY',enabled=False,path='users/alice',method='update',data={'twoFactorEnabled':True},write={'twoFactorEnabled':False})
case('Cannot edit authenticator metadata directly','DENY',enabled=False,path='users/alice/security/settings',method='update',data={'twoFactorEnabled':True},write={'twoFactorEnabled':False})
case('Cannot forge proof document','DENY',enabled=False,path='funded_mfa_sessions/'+sid,method='create',write={'uid':uid,'version':'v1','expiresAt':1790607600000})
case('Cannot read legacy secret','DENY',enabled=False,path='users/alice/security/settings',data={'twoFactorSecret':'FAKE_TEST_ONLY'})
case('Cannot change private factor','DENY',enabled=False,path='funded_mfa_private/alice',method='update',data={'enabled':True},write={'enabled':False})
config=json.loads((pathlib.Path.home()/'.config/configstore/firebase-tools.json').read_text());token=config['tokens']['access_token']
body={'source':{'files':[{'name':'firestore.rules','content':(w/'firestore.mfa.rules').read_text()}]},'testSuite':{'testCases':cases}}
req=urllib.request.Request('https://firebaserules.googleapis.com/v1/projects/fynx-c7a28:test',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
try:
 with urllib.request.urlopen(req,timeout=30) as r:d=json.load(r)
 report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rulesSha256':hashlib.sha256((w/'firestore.mfa.rules').read_bytes()).hexdigest(),'issues':d.get('issues',[]),'checks':[{'name':n,'state':r.get('state'),'debugMessages':r.get('debugMessages',[])} for n,r in zip(names,d.get('testResults',[]))]}
 (w/'docs/ios-completion-2026-10-11/mfa-rules-tests.json').write_text(json.dumps(report,indent=2)+'\n')
 print('Issues:',d.get('issues',[]))
 for n,r in zip(names,d.get('testResults',[])):print(n,r.get('state'),r.get('debugMessages',[]))
 if d.get('issues') or len(d.get('testResults',[])) != len(cases) or any(r.get('state') != 'SUCCESS' for r in d.get('testResults',[])):
  sys.exit('Rules verification failed')
except urllib.error.HTTPError as e:
 print('HTTP',e.code,e.read().decode()[:1000]);sys.exit(1)
