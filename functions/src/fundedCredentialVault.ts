import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export type Binding = { userId: string; challengeId: string; accountId: string };
export type SealedCredential = Binding & { version: 1; iv: string; ciphertext: string; tag: string };
function key(secret: string) { const value = Buffer.from(secret, 'base64'); if (value.length !== 32 || value.toString('base64') !== secret) throw Error('Credential encryption is not configured.'); return value; }
function aad(binding: Binding) { return Buffer.from(JSON.stringify([1, binding.userId, binding.challengeId, binding.accountId])); }
export function sealCredential(password: string, binding: Binding, secret: string): SealedCredential {
  if (!password || password.length > 4096) throw Error('Invalid credential.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), iv); cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return { ...binding, version: 1, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function openCredential(record: SealedCredential, binding: Binding, secret: string) {
  if (record.version !== 1 || record.userId !== binding.userId || record.challengeId !== binding.challengeId || record.accountId !== binding.accountId) throw Error('Credential binding mismatch.');
  const iv = Buffer.from(record.iv, 'base64'), tag = Buffer.from(record.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16 || record.ciphertext.length > 6000) throw Error('Invalid encrypted credential.');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), iv); decipher.setAAD(aad(binding)); decipher.setAuthTag(tag);
  const password = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  if (!password) throw Error('Missing credential.'); return password;
}
