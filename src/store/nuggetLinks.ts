import { pool } from '../db';

export interface NuggetLink {
  id: string;
  userId: string;
  nuggetAId: string;
  nuggetBId: string;
  note: string | null;
  source: 'manual' | 'ai_suggested';
  createdAt: string;
}

// The shape callers actually want: a link joined with the *other* nugget's
// content, from the perspective of one specific nugget. Both getLinksForNugget
// and createNuggetLink return this so the client only ever decodes one shape
// regardless of which endpoint it called.
export interface LinkedNoteView {
  linkId: string;
  note: string | null;
  source: string;
  createdAt: string;
  nugget: { id: string; content: string; collectionId: string };
}

// A link's identity is unordered, but the row is stored with the smaller id
// first (see the `nugget_links_ordered` CHECK constraint) so a pair is never
// stored twice regardless of which nugget initiated the link.
//
// Postgres compares UUIDs by their parsed bytes, so the ordering has to be done
// on a canonical lowercase form. Comparing the raw input as JS strings puts
// 'A' (65) before 'a' (97) and can disagree with the CHECK constraint whenever
// the two ids differ in case.
function orderedPair(nuggetId: string, targetNuggetId: string): [string, string] {
  const a = nuggetId.toLowerCase();
  const b = targetNuggetId.toLowerCase();
  return a < b ? [a, b] : [b, a];
}

function mapRow(r: any): NuggetLink {
  return {
    id: r.id,
    userId: r.user_id,
    nuggetAId: r.nugget_a_id,
    nuggetBId: r.nugget_b_id,
    note: r.note,
    source: r.source,
    createdAt: r.created_at,
  };
}

export async function createNuggetLink(input: {
  userId: string;
  nuggetId: string;
  targetNuggetId: string;
  note?: string;
  source?: 'manual' | 'ai_suggested';
}): Promise<NuggetLink> {
  const [a, b] = orderedPair(input.nuggetId, input.targetNuggetId);
  const { rows } = await pool.query(
    `INSERT INTO nugget_links (user_id, nugget_a_id, nugget_b_id, note, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (nugget_a_id, nugget_b_id) DO UPDATE
       SET note = COALESCE(EXCLUDED.note, nugget_links.note)
     RETURNING *`,
    [input.userId, a, b, input.note ?? null, input.source ?? 'manual'],
  );
  return mapRow(rows[0]);
}

function mapLinkedNoteRow(r: any): LinkedNoteView {
  return {
    linkId: r.link_id,
    note: r.note,
    source: r.source,
    createdAt: r.created_at,
    nugget: { id: r.nugget_id, content: r.content, collectionId: r.collection_id },
  };
}

// Returns links for a nugget joined with the *other* nugget's content, so
// callers get everything needed to render a "linked notes" row without a
// second round trip.
export async function getLinksForNugget(nuggetId: string, userId: string): Promise<LinkedNoteView[]> {
  const { rows } = await pool.query(
    `SELECT
       l.id AS link_id, l.note, l.source, l.created_at,
       n.id AS nugget_id, n.content, n.collection_id
     FROM nugget_links l
     JOIN nuggets n ON n.id = (CASE WHEN l.nugget_a_id = $1 THEN l.nugget_b_id ELSE l.nugget_a_id END)
     WHERE l.user_id = $2 AND (l.nugget_a_id = $1 OR l.nugget_b_id = $1)
     ORDER BY l.created_at DESC`,
    [nuggetId, userId],
  );
  return rows.map(mapLinkedNoteRow);
}

// Same joined shape as getLinksForNugget, but for a single link by id — used
// right after creating a link so the response matches what GET .../links
// already returns, instead of the raw nugget_links row.
export async function getLinkedNoteView(
  linkId: string, perspectiveNuggetId: string, userId: string,
): Promise<LinkedNoteView | undefined> {
  const { rows } = await pool.query(
    `SELECT
       l.id AS link_id, l.note, l.source, l.created_at,
       n.id AS nugget_id, n.content, n.collection_id
     FROM nugget_links l
     JOIN nuggets n ON n.id = (CASE WHEN l.nugget_a_id = $2 THEN l.nugget_b_id ELSE l.nugget_a_id END)
     WHERE l.id = $1 AND l.user_id = $3`,
    [linkId, perspectiveNuggetId, userId],
  );
  return rows[0] ? mapLinkedNoteRow(rows[0]) : undefined;
}

export async function deleteNuggetLink(linkId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM nugget_links WHERE id = $1 AND user_id = $2`,
    [linkId, userId],
  );
  return (rowCount ?? 0) > 0;
}
