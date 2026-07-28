import { pool } from '../db';
import { escapeIlike } from '../middleware/validate';

export type UserRole = 'user' | 'support' | 'admin';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

function rowToUser(row: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
  };
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
     RETURNING id, email, first_name, last_name, role`,
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
    `SELECT id, email, first_name, last_name, role FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

export async function getUserRole(id: string): Promise<UserRole | undefined> {
  const { rows } = await pool.query(`SELECT role FROM users WHERE id = $1`, [id]);
  return rows[0]?.role;
}

export async function updateUser(
  id: string,
  fields: { firstName?: string; lastName?: string; email?: string },
): Promise<PublicUser | undefined> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (fields.firstName !== undefined) { sets.push(`first_name = trim($${i++})`); vals.push(fields.firstName); }
  if (fields.lastName  !== undefined) { sets.push(`last_name  = trim($${i++})`); vals.push(fields.lastName); }
  if (fields.email     !== undefined) { sets.push(`email      = lower(trim($${i++}))`); vals.push(fields.email); }
  if (!sets.length) return getUserById(id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, email, first_name, last_name, role`,
    vals,
  );
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

export async function deleteUser(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function setUserRole(id: string, role: UserRole): Promise<PublicUser | undefined> {
  const { rows } = await pool.query(
    `UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, first_name, last_name, role`,
    [id, role],
  );
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

export interface UserListItem extends PublicUser {
  createdAt: string;
  collectionCount: number;
}

export async function listUsers(opts: {
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ items: UserListItem[]; total: number }> {
  const conditions: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (opts.search?.trim()) {
    conditions.push(
      `(lower(u.email) LIKE lower($${i}) ESCAPE '\\' OR lower(u.first_name) LIKE lower($${i}) ESCAPE '\\' OR lower(u.last_name) LIKE lower($${i}) ESCAPE '\\')`,
    );
    vals.push(`%${escapeIlike(opts.search.trim())}%`);
    i++;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM users u ${where}`,
    vals,
  );

  vals.push(opts.limit, opts.offset);
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at,
            COUNT(c.id)::int AS collection_count
     FROM users u
     LEFT JOIN collections c ON c.user_id = u.id
     ${where}
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    vals,
  );

  return {
    total: countRows[0]?.count ?? 0,
    items: rows.map((row) => ({
      ...rowToUser(row),
      createdAt: row.created_at,
      collectionCount: row.collection_count,
    })),
  };
}
