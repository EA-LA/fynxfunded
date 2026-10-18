// One local command; never deploys or imports production data/credentials.
const fs = require('node:fs'), path = require('node:path'), { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), stage = path.join(root, '.trade-dev');
fs.mkdirSync(stage, { recursive: true });
execFileSync('npm', ['--prefix', 'functions', 'run', 'build'], { cwd: root, stdio: 'inherit' });
fs.mkdirSync(path.join(stage, 'functions'), { recursive: true });
const compiled = path.join(stage, 'functions/lib');
if (fs.existsSync(compiled) && fs.lstatSync(compiled).isSymbolicLink()) fs.unlinkSync(compiled);
fs.cpSync(path.join(root, 'functions/lib'), compiled, { recursive: true });
for (const dir of ['node_modules']) { const dest = path.join(stage, 'functions', dir); if (!fs.existsSync(dest)) fs.symlinkSync(path.join(root, 'functions', dir), dest, 'dir'); }
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json'))); pkg.main = 'lib/tradeDev/index.js';
fs.writeFileSync(path.join(stage, 'functions/package.json'), JSON.stringify(pkg));
fs.copyFileSync(path.join(__dirname, 'firestore.rules'), path.join(stage, 'firestore.rules'));
fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: 'functions' }, firestore: { rules: 'firestore.rules' }, emulators: { auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8089 }, functions: { host: '127.0.0.1', port: 5009 }, hub: { host: '127.0.0.1', port: 4409 }, logging: { host: '127.0.0.1', port: 4509 }, ui: { enabled: false }, singleProjectMode: true } }));
const env = { ...process.env, GCLOUD_PROJECT: 'demo-fynx-trade', GOOGLE_CLOUD_PROJECT: 'demo-fynx-trade', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8089', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', VITE_FYNX_TRADE_DEV: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-fynx-trade', VITE_FIREBASE_API_KEY: 'development-only', VITE_FIREBASE_AUTH_DOMAIN: 'demo-fynx-trade.firebaseapp.com', VITE_FIREBASE_APP_ID: '1:123:web:development', VITE_FIREBASE_STORAGE_BUCKET: 'demo-fynx-trade.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '123' };
delete env.GOOGLE_APPLICATION_CREDENTIALS; delete env.FIREBASE_TOKEN;
const children = [], start = (bin, args, cwd = root) => { const child = spawn(bin, args, { cwd, env, stdio: 'inherit' }); children.push(child); return child; };
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
async function ready(url, callable = false) { for (let i = 0; i < 90; i++) { try { const r = await fetch(url); if (r.status < 500 && (!callable || r.status !== 404 && r.headers.get('content-type')?.includes('application/json'))) return; } catch {} await new Promise(r => setTimeout(r, 1000)); } throw Error('Local emulator did not start.'); }
(async () => {
  const emulator = start(process.env.FIREBASE_CLI || 'firebase', ['emulators:start', '--project', 'demo-fynx-trade', '--config', path.join(stage, 'firebase.json'), '--only', 'auth,firestore,functions', '--export-on-exit', path.join(stage, 'state'), ...(fs.existsSync(path.join(stage, 'state/firebase-export-metadata.json')) ? ['--import', path.join(stage, 'state')] : [])]);
  emulator.on('exit', code => { if (!stopping) { console.error('Emulator stopped:', code); stop(); } });
  await ready('http://127.0.0.1:9099/'); await ready('http://127.0.0.1:8089/'); await ready('http://127.0.0.1:5009/demo-fynx-trade/us-central1/fundedMfa', true);
  start(process.execPath, [path.join(__dirname, 'worker.cjs')]);
  start(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5189', '--strictPort']);
  console.log('FYNX Trade development: http://127.0.0.1:5189/trade — synthetic only; local data is saved under .trade-dev/state on clean exit.');
})().catch(error => { console.error(error.message); stop(); process.exitCode = 1; });
