import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Computed on first use rather than at import so startup doesn't pay for a
// cost-12 hash that most processes will never need.
let dummyHash: string | undefined;

async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword(crypto.randomBytes(32).toString('hex'));
  return dummyHash;
}

// `hash` is optional so callers can pass the result of a lookup that may have
// missed. When it's absent we still run a full bcrypt comparison against a
// throwaway hash: returning early would make a request for an unregistered
// email measurably faster than one for a real account, which is enough to
// enumerate users.
export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  const matches = await bcrypt.compare(password, hash ?? (await getDummyHash()));
  return hash !== undefined && matches;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
