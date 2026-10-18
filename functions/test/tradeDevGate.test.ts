import { afterEach, describe, expect, it, vi } from 'vitest';
import { developmentOnly } from '../src/tradeDev/service';
afterEach(() => vi.unstubAllEnvs());
describe('development environment boundary', () => {
  it.each([
    ['fynx-c7a28','127.0.0.1:8089','127.0.0.1:9099'],
    ['demo-fynx-trade','','127.0.0.1:9099'],
    ['demo-fynx-trade','127.0.0.1:8089',''],
    ['demo-fynx-trade','remote:8089','127.0.0.1:9099'],
  ])('rejects project/hosts %s %s %s', (project, firestore, auth) => {
    vi.stubEnv('GCLOUD_PROJECT', project); vi.stubEnv('FIRESTORE_EMULATOR_HOST', firestore); vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', auth);
    expect(developmentOnly).toThrow('isolated development emulator');
  });
  it('accepts only the pinned local project and loopback emulators', () => {
    vi.stubEnv('GCLOUD_PROJECT','demo-fynx-trade'); vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8089'); vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST','127.0.0.1:9099');
    expect(developmentOnly).not.toThrow();
  });
});
