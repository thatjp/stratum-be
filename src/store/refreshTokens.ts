import { pool } from '../db';
import { hashToken } from '../services/authCrypto';

export async function saveRefreshToken(userId: string, token: string, expiresAt: Date): Promise<void> {
  const hash = hashToken(token);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt],
  );
}

export async function findAndDeleteRefreshToken(
  token: string,
): Promise<{ userId: string } | undefined> {
  const hash = hashToken(token);
  const { rows } = await pool.query(
    `DELETE FROM refresh_tokens
     WHERE token_hash = $1 AND expires_at > NOW()
     RETURNING user_id`,
    [hash],
  );
  return rows[0] ? { userId: rows[0].user_id } : undefined;
}

export async function deleteUserRefreshTokens(userId: string): Promise<void> {
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
}
