// Emulator-only entry point. This is intentionally NOT exported from production index.ts.
import * as admin from 'firebase-admin';
admin.initializeApp({ projectId: 'demo-fynx-trade' });
export { fundedMfa } from '../fundedMfa';
export { fynxTradeDev } from './service';
