import { pool } from '../db';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

function rowToUser(row: { id: string; email: string; first_name: string; last_name: string }): PublicUser {
  return { id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name };
}

export async function createUser(
  email: string,
  passwordHash: string,
  firstName: string,
  lastName: string,
): Promise<PublicUser> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name)
     VALUES (lower(trim($1)), $2, trim($3), trim($4))
     RETURNING id, email, first_name, last_name`,
    [email, passwordHash, firstName, lastName],
  );
  return rowToUser(rows[0]);
}

export async function getUserAuthByEmail(
  email: string,
): Promise<{ id: string; passwordHash: string } | undefined> {
  const { rows } = await pool.query(
    `SELECT id, password_hash FROM users WHERE lower(email) = lower(trim($1))`,
    [email],
  );
  return rows[0] ? { id: rows[0].id, passwordHash: rows[0].password_hash } : undefined;
}

export async function getUserById(id: string): Promise<PublicUser | undefined> {
  const { rows } = await pool.query(
    `SELECT id, email, first_name, last_name FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToUser(rows[0]) : undefined;
}
