const admin = require('../../functions/node_modules/firebase-admin');
const { developmentOnly, transact } = require('../../functions/lib/tradeDev/service');
const { deliverDevelopmentMail } = require('../../functions/lib/tradeDev/lifecycle');
developmentOnly(); admin.initializeApp({ projectId: 'demo-fynx-trade' });
let stopping = false; process.on('SIGTERM', () => { stopping = true; });
(async () => {
  while (!stopping) {
    try {
      const now = Date.now(), rows = await admin.firestore().collection('accounts').where('environment', '==', 'development').where('status', '==', 'active').limit(100).get();
      await Promise.all(rows.docs.map(async doc => {
        try { await transact(doc.data().userId, doc.id, { action: 'tick' }, `tick-${now}`, now); }
        catch (e) { console.error('Development mark failed:', doc.id, e.message); }
      }));
      await deliverDevelopmentMail();
    } catch (e) { console.error('Development worker:', e.message); }
    await new Promise(r => setTimeout(r, 1000));
  }
})().catch(() => { process.exitCode = 1; });
