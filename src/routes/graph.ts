import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const graphRouter = Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type NodeType =
  | 'conversation'
  | 'collection'
  | 'archived_conversation'
  | 'archived_collection'
  | 'nugget';

interface GraphNode {
  id:        string;
  type:      NodeType;
  label:     string;
  synopsis:  string | null;
  createdAt: string;
}

interface GraphEdge {
  source: string;
  target: string;
}

// ─── GET /graph ───────────────────────────────────────────────────────────────

graphRouter.get('/', asyncHandler(async (req, res) => {
  const userId = res.locals.userId!;

  const [convRows, archConvRows, collRows, archCollRows, nuggetRows] = await Promise.all([
    pool.query(
      `SELECT id, title, synopsis, created_at FROM conversations
       WHERE user_id = $1 AND archived_at IS NULL`,
      [userId],
    ),
    pool.query(
      `SELECT id, title, ghost_synopsis AS synopsis, created_at FROM conversations
       WHERE user_id = $1 AND archived_at IS NOT NULL`,
      [userId],
    ),
    pool.query(
      `SELECT id, title, NULL::text AS synopsis, created_at FROM collections
       WHERE user_id = $1 AND archived_at IS NULL`,
      [userId],
    ),
    pool.query(
      `SELECT id, title, ghost_synopsis AS synopsis, created_at FROM collections
       WHERE user_id = $1 AND archived_at IS NOT NULL`,
      [userId],
    ),
    pool.query(
      `SELECT id, content AS title, NULL::text AS synopsis, created_at, collection_id
       FROM nuggets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1001`,
      [userId],
    ),
  ]);

  const nodes: GraphNode[] = [
    ...convRows.rows.map((r) => ({
      id:        r.id as string,
      type:      'conversation' as const,
      label:     (r.title as string | null) ?? 'Untitled conversation',
      synopsis:  r.synopsis as string | null,
      createdAt: r.created_at as string,
    })),
    ...archConvRows.rows.map((r) => ({
      id:        r.id as string,
      type:      'archived_conversation' as const,
      label:     (r.title as string | null) ?? 'Archived conversation',
      synopsis:  r.synopsis as string | null,
      createdAt: r.created_at as string,
    })),
    ...collRows.rows.map((r) => ({
      id:        r.id as string,
      type:      'collection' as const,
      label:     r.title as string,
      synopsis:  null,
      createdAt: r.created_at as string,
    })),
    ...archCollRows.rows.map((r) => ({
      id:        r.id as string,
      type:      'archived_collection' as const,
      label:     r.title as string,
      synopsis:  r.synopsis as string | null,
      createdAt: r.created_at as string,
    })),
    ...nuggetRows.rows.map((r) => ({
      id:        r.id as string,
      type:      'nugget' as const,
      label:     truncate(r.title as string, 60),
      synopsis:  null,
      createdAt: r.created_at as string,
    })),
  ];

  const nodeIds = new Set(nodes.map((n) => n.id));

  // conv → collection edges
  const convEdgeRows = await pool.query(
    `SELECT id AS conv_id, collection_id FROM conversations
     WHERE user_id = $1 AND collection_id IS NOT NULL`,
    [userId],
  );
  // nugget → collection edges
  const nuggetEdgeRows = nuggetRows.rows.filter((r) => r.collection_id != null);

  const edges: GraphEdge[] = [
    ...convEdgeRows.rows
      .filter((r) => nodeIds.has(r.conv_id as string) && nodeIds.has(r.collection_id as string))
      .map((r) => ({ source: r.conv_id as string, target: r.collection_id as string })),
    ...nuggetEdgeRows
      .filter((r) => nodeIds.has(r.collection_id as string))
      .map((r) => ({ source: r.id as string, target: r.collection_id as string })),
  ];

  const NUGGET_DISPLAY_LIMIT = 1000;
  const nuggetsTruncated = nuggetRows.rows.length > NUGGET_DISPLAY_LIMIT;
  if (nuggetsTruncated) nuggetRows.rows.splice(NUGGET_DISPLAY_LIMIT);

  res.json({ nodes, edges, truncated: nuggetsTruncated });
}));

// ─── GET /graph/search?q= ─────────────────────────────────────────────────────
// Searches across conversations, collections, and nuggets — returns matching GraphNodes

graphRouter.get('/search', asyncHandler(async (req, res) => {
  const userId = res.locals.userId!;
  const q      = String(req.query.q ?? '').trim();
  if (!q) return res.json({ nodes: [] });

  const pattern = `%${q}%`;

  const [convRows, collRows, nuggetRows] = await Promise.all([
    pool.query(
      `SELECT id, title, synopsis, created_at FROM conversations
       WHERE user_id = $1 AND archived_at IS NULL AND title ILIKE $2
       LIMIT 20`,
      [userId, pattern],
    ),
    pool.query(
      `SELECT id, title, NULL::text AS synopsis, created_at FROM collections
       WHERE user_id = $1 AND archived_at IS NULL AND title ILIKE $2
       LIMIT 20`,
      [userId, pattern],
    ),
    pool.query(
      `SELECT id, content AS title, NULL::text AS synopsis, created_at FROM nuggets
       WHERE user_id = $1 AND content ILIKE $2
       LIMIT 20`,
      [userId, pattern],
    ),
  ]);

  const nodes: GraphNode[] = [
    ...convRows.rows.map((r) => ({
      id: r.id as string, type: 'conversation' as const,
      label: (r.title as string | null) ?? 'Untitled conversation',
      synopsis: r.synopsis as string | null, createdAt: r.created_at as string,
    })),
    ...collRows.rows.map((r) => ({
      id: r.id as string, type: 'collection' as const,
      label: r.title as string, synopsis: null, createdAt: r.created_at as string,
    })),
    ...nuggetRows.rows.map((r) => ({
      id: r.id as string, type: 'nugget' as const,
      label: truncate(r.title as string, 60), synopsis: null, createdAt: r.created_at as string,
    })),
  ];

  res.json({ nodes });
}));

// ─── POST /graph/related ──────────────────────────────────────────────────────
// Body: { artifactId, artifactType: 'conversation'|'collection'|'nugget' }
// Returns up to 5 related nodes (from the user's existing graph) that Claude
// considers semantically related to the selected artifact.

graphRouter.post('/related', asyncHandler(async (req, res) => {
  const userId       = res.locals.userId!;
  const artifactId   = String(req.body.artifactId ?? '');
  const artifactType = String(req.body.artifactType ?? '');

  if (!artifactId || !artifactType) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'artifactId and artifactType are required');
  }

  // Fetch the source artifact's content
  const sourceLabel = await fetchLabel(artifactId, artifactType, userId);
  if (!sourceLabel) return sendError(res, 404, 'NOT_FOUND', 'Artifact not found');

  // Fetch all other artifacts as candidates
  const [convRows, collRows, nuggetRows] = await Promise.all([
    pool.query(
      `SELECT id, COALESCE(title, 'Untitled conversation') AS label, synopsis AS body, 'conversation' AS type
       FROM conversations WHERE user_id = $1 AND archived_at IS NULL AND id != $2`,
      [userId, artifactId],
    ),
    pool.query(
      `SELECT id, title AS label, NULL AS body, 'collection' AS type
       FROM collections WHERE user_id = $1 AND archived_at IS NULL AND id != $2`,
      [userId, artifactId],
    ),
    pool.query(
      `SELECT id, content AS label, NULL AS body, 'nugget' AS type
       FROM nuggets WHERE user_id = $1 AND id != $2 LIMIT 100`,
      [userId, artifactId],
    ),
  ]);

  type Candidate = { id: string; label: string; body: string | null; type: string };
  const candidates: Candidate[] = [
    ...convRows.rows, ...collRows.rows, ...nuggetRows.rows,
  ].map((r) => ({
    id: r.id as string, label: truncate(r.label as string, 80),
    body: r.body as string | null, type: r.type as string,
  }));

  if (!candidates.length) return res.json({ relatedNodes: [] });

  // Ask Claude which candidates are most related
  const candidateList = candidates
    .map((c, i) => `[${i}] (${c.type}) ${c.label}${c.body ? ` — ${truncate(c.body, 120)}` : ''}`)
    .join('\n');

  const MAX_RELATED = 10;

  const prompt = `You are helping a learner surface related material in a knowledge graph.

Source artifact (${artifactType}): "${sourceLabel}"

Candidate artifacts:
${candidateList}

Identify up to ${MAX_RELATED} candidates that are most relevant to the source artifact. Prioritise:
- Shared key topics, questions, or concepts
- Material that deepens or extends understanding of the source
- Connections a learner would benefit from exploring

Respond with ONLY a JSON array of integer indices (from the list above), e.g. [0, 3, 7]. No explanation.`;

  let relatedIndices: number[] = [];
  try {
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 128,
      messages:   [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '[]';
    // Extract JSON array even if Claude adds a tiny preamble
    const match = text.match(/\[[\d,\s]*\]/);
    relatedIndices = match ? JSON.parse(match[0]) : [];
    if (!Array.isArray(relatedIndices)) relatedIndices = [];
  } catch {
    relatedIndices = [];
  }

  const relatedNodes: GraphNode[] = relatedIndices
    .filter((i) => typeof i === 'number' && i >= 0 && i < candidates.length)
    .slice(0, MAX_RELATED)
    .map((i) => {
      const c = candidates[i];
      return {
        id:        c.id,
        type:      c.type as NodeType,
        label:     c.label,
        synopsis:  c.body ? truncate(c.body, 200) : null,
        createdAt: new Date().toISOString(),
      };
    });

  res.json({ relatedNodes });
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function fetchLabel(id: string, type: string, userId: string): Promise<string | null> {
  if (type === 'conversation') {
    const { rows } = await pool.query(
      `SELECT COALESCE(title, 'Untitled conversation') AS label FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows[0]?.label ?? null;
  }
  if (type === 'collection') {
    const { rows } = await pool.query(
      `SELECT title AS label FROM collections WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows[0]?.label ?? null;
  }
  if (type === 'nugget') {
    const { rows } = await pool.query(
      `SELECT content AS label FROM nuggets WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows[0]?.label ?? null;
  }
  return null;
}
