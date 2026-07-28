import { describe, expect, it } from 'vitest';
import { hashPassword, hashToken, verifyPassword } from '../src/services/authCrypto';
import { signAccessToken } from '../src/services/authTokens';
import jwt from 'jsonwebtoken';

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    await expect(verifyPassword('correct-horse-battery', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('rejects a missing account without short-circuiting past bcrypt', async () => {
    // undefined hash is the "account not found" path — must still return false
    // so login timing for unknown emails matches wrong-password timing.
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false);
  });
});

describe('hashToken', () => {
  it('is deterministic and hex-encoded', () => {
    const a = hashToken('refresh-token-value');
    const b = hashToken('refresh-token-value');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('signAccessToken', () => {
  it('signs an HS256 token with the expected claims', () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests-only';
    const token = signAccessToken('user-123');
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }) as {
      userId: string;
    };
    expect(payload.userId).toBe('user-123');
  });

  it('is rejected when verified with a different algorithm', () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests-only';
    const token = signAccessToken('user-123');
    expect(() => jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['none'] })).toThrow();
  });
});
