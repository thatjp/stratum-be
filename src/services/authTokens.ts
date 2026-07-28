import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ACCESS_TTL  = '15m';
const REFRESH_TTL = '90d';

export function signAccessToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: ACCESS_TTL, algorithm: 'HS256' });
}

export function signRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

export function refreshTokenExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d;
}
