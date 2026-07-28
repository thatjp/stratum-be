import { pool } from '../db';
import * as reviewStore from './review';
import * as collectionsStore from './collections';
import type { Collection } from './collections';

export type HomeSuggestionType =
  | 'review_due'
  | 'capture_stale'
  | 'quiz_weak'
  | 'add_goal'
  | 'start_capture';

export interface HomeSuggestion {
  id: string;
  type: HomeSuggestionType;
  title: string;
  subtitle: string;
  collectionId: string | null;
  priority: number;
}

export interface HomeCollectionCard {
  collection: Collection;
  avgProficiency: number;
  dueCount: number;
  atRiskCount: number;
  nodeCount: number;
  daysUntilTarget: number | null;
  urgencyScore: number;
  /** Up to 12 proficiency samples for the mini map strip (0–1). */
  proficiencySample: number[];
}

/** One collection as a spatial “bed” on the home garden. */
export interface GardenPatch {
  collectionId: string;
  title: string;
  goal: string | null;
  goalTargetAt: string | null;
  daysUntilTarget: number | null;
  avgProficiency: number;
  dueCount: number;
  atRiskCount: number;
  nodeCount: number;
  lastActivityAt: string | null;
  urgencyScore: number;
  /** Normalized 0–1 position in garden bounds. */
  x: number;
  y: number;
  /** Normalized radius (roughly 0.06–0.16). */
  radius: number;
}

export interface GardenBridge {
  id: string;
  aCollectionId: string;
  bCollectionId: string;
  linkCount: number;
  strength: number;
  samples: {
    nuggetAId: string;
    nuggetBId: string;
    labelA: string;
    labelB: string;
  }[];
}

export interface HomeGarden {
  layoutVersion: number;
  patches: GardenPatch[];
  /** Phase B — always empty for now. */
  bridges: GardenBridge[];
}

export interface HomePayload {
  stats: reviewStore.UserStats;
  collections: HomeCollectionCard[];
  suggestions: HomeSuggestion[];
  garden: HomeGarden;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86_400_000);
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function urgencyScore(input: {
  daysUntilTarget: number | null;
  dueCount: number;
  atRiskCount: number;
  daysSinceSession: number | null;
  hasGoal: boolean;
}): number {
  let score = 0;
  const { daysUntilTarget, dueCount, atRiskCount, daysSinceSession, hasGoal } = input;

  if (daysUntilTarget !== null) {
    if (daysUntilTarget <= 0)      score += 100;
    else if (daysUntilTarget <= 7) score += 80;
    else if (daysUntilTarget <= 14) score += 55;
    else if (daysUntilTarget <= 30) score += 30;
    else score += 10;
  }

  score += Math.min(dueCount * 4, 40);
  score += Math.min(atRiskCount * 3, 30);

  if (daysSinceSession !== null && daysSinceSession >= 5) {
    score += Math.min(daysSinceSession, 20);
  }

  if (!hasGoal) score += 15;

  return score;
}

/** Stable 0–1 float from an id string (FNV-1a style). */
function hashUnit(id: string, salt = ''): number {
  const s = id + salt;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function radiusFromNodeCount(nodeCount: number): number {
  const t = Math.min(nodeCount, 80) / 80;
  return 0.07 + t * 0.08;
}

/**
 * Deterministic garden layout: hash-seeded positions, then a few repulsion
 * passes in id order so patches don't sit on top of each other. Urgency must
 * not move beds — only health/size change across refreshes.
 */
function layoutGardenPatches(cards: HomeCollectionCard[]): GardenPatch[] {
  const ordered = [...cards].sort((a, b) =>
    a.collection.id.localeCompare(b.collection.id),
  );

  type Pt = { x: number; y: number; r: number; card: HomeCollectionCard };
  const pts: Pt[] = ordered.map((card) => {
    const x = 0.18 + hashUnit(card.collection.id, 'x') * 0.64;
    const y = 0.20 + hashUnit(card.collection.id, 'y') * 0.58;
    return { x, y, r: radiusFromNodeCount(card.nodeCount), card };
  });

  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const minDist = a.r + b.r + 0.04;
        if (dist >= minDist) continue;
        const push = (minDist - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    for (const p of pts) {
      p.x = clamp(p.x, 0.12, 0.88);
      p.y = clamp(p.y, 0.14, 0.86);
    }
  }

  return pts.map(({ x, y, r, card }) => {
    const c = card.collection;
    return {
      collectionId: c.id,
      title: c.title,
      goal: c.goal ?? null,
      goalTargetAt: c.goalTargetAt ?? null,
      daysUntilTarget: card.daysUntilTarget,
      avgProficiency: card.avgProficiency,
      dueCount: card.dueCount,
      atRiskCount: card.atRiskCount,
      nodeCount: card.nodeCount,
      lastActivityAt: c.lastSessionAt ?? null,
      urgencyScore: card.urgencyScore,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      radius: Math.round(r * 1000) / 1000,
    };
  });
}

export async function getHome(userId: string): Promise<HomePayload> {
  const emptyGarden: HomeGarden = { layoutVersion: 1, patches: [], bridges: [] };

  const [stats, collections] = await Promise.all([
    reviewStore.getUserStats(userId),
    collectionsStore.getCollections(userId),
  ]);

  if (collections.length === 0) {
    return {
      stats,
      collections: [],
      suggestions: [{
        id: 'start_first',
        type: 'start_capture',
        title: 'Create your first collection',
        subtitle: 'Set a goal, then capture what you\'re reading.',
        collectionId: null,
        priority: 100,
      }],
      garden: emptyGarden,
    };
  }

  const ids = collections.map((c) => c.id);

  const { rows: dueRows } = await pool.query(
    `SELECT n.collection_id, COUNT(*)::int AS due_count
     FROM artifacts a
     JOIN nuggets n ON a.nugget_id = n.id
     WHERE a.user_id = $1
       AND a.status = 'accepted'
       AND (a.due_at IS NULL OR a.due_at <= NOW())
       AND n.collection_id = ANY($2::uuid[])
     GROUP BY n.collection_id`,
    [userId, ids],
  );
  const dueByCollection = new Map<string, number>(
    dueRows.map((r) => [r.collection_id as string, Number(r.due_count)]),
  );

  const { rows: nuggetRows } = await pool.query(
    `SELECT
       n.id,
       n.collection_id,
       COUNT(ra.id)::int AS total_attempts,
       COUNT(ra.id) FILTER (WHERE ra.result = 'correct')::int AS correct_attempts,
       MAX(a.interval_days) FILTER (WHERE a.status = 'accepted') AS max_interval,
       COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'accepted')::int AS artifact_count
     FROM nuggets n
     LEFT JOIN artifacts a ON a.nugget_id = n.id AND a.user_id = $1
     LEFT JOIN recall_attempts ra ON ra.artifact_id = a.id AND ra.user_id = $1
     WHERE n.user_id = $1 AND n.collection_id = ANY($2::uuid[])
     GROUP BY n.id, n.collection_id
     ORDER BY n.created_at ASC`,
    [userId, ids],
  );

  type NuggetStat = { collectionId: string; proficiency: number };
  const nuggetStats: NuggetStat[] = nuggetRows.map((r) => {
    const totalAttempts   = Number(r.total_attempts);
    const correctAttempts = Number(r.correct_attempts);
    const maxInterval     = Number(r.max_interval ?? 1);
    const artifactCount   = Number(r.artifact_count ?? 0);

    let proficiency: number;
    if (totalAttempts > 0) {
      const recallRate    = correctAttempts / totalAttempts;
      const intervalScore = Math.min(maxInterval / 21, 1);
      proficiency = recallRate * 0.8 + intervalScore * 0.2;
    } else if (artifactCount > 0) {
      proficiency = 0.1;
    } else {
      proficiency = 0.05;
    }

    return {
      collectionId: r.collection_id as string,
      proficiency: Math.round(proficiency * 100) / 100,
    };
  });

  const byCollection = new Map<string, number[]>();
  for (const n of nuggetStats) {
    const list = byCollection.get(n.collectionId) ?? [];
    list.push(n.proficiency);
    byCollection.set(n.collectionId, list);
  }

  const cards: HomeCollectionCard[] = collections.map((collection) => {
    const profs = byCollection.get(collection.id) ?? [];
    const avgProficiency = profs.length
      ? Math.round((profs.reduce((s, p) => s + p, 0) / profs.length) * 100)
      : 0;
    const atRiskCount = profs.filter((p) => p <= 0.45).length;
    const dueCount = dueByCollection.get(collection.id) ?? 0;
    const daysUntilTarget = daysUntil(collection.goalTargetAt);
    const daysSinceSession = daysSince(collection.lastSessionAt);
    const sampleStep = Math.max(1, Math.floor(profs.length / 12));
    const proficiencySample = profs.filter((_, i) => i % sampleStep === 0).slice(0, 12);

    return {
      collection,
      avgProficiency,
      dueCount,
      atRiskCount,
      nodeCount: profs.length,
      daysUntilTarget,
      urgencyScore: urgencyScore({
        daysUntilTarget,
        dueCount,
        atRiskCount,
        daysSinceSession,
        hasGoal: Boolean(collection.goal?.trim()),
      }),
      proficiencySample,
    };
  });

  cards.sort((a, b) => b.urgencyScore - a.urgencyScore);

  const suggestions: HomeSuggestion[] = [];

  for (const card of cards) {
    const c = card.collection;
    if (!c.goal?.trim()) {
      suggestions.push({
        id: `goal-${c.id}`,
        type: 'add_goal',
        title: `Set a goal for ${c.title}`,
        subtitle: 'Goals tell Stratum what to prioritize on your maps.',
        collectionId: c.id,
        priority: 90,
      });
    }

    if (card.dueCount > 0) {
      const urgency =
        card.daysUntilTarget !== null && card.daysUntilTarget <= 14
          ? card.daysUntilTarget <= 0
            ? 'Past your target — '
            : `${card.daysUntilTarget}d to goal — `
          : '';
      suggestions.push({
        id: `due-${c.id}`,
        type: 'review_due',
        title: `Review ${card.dueCount} card${card.dueCount === 1 ? '' : 's'} · ${c.title}`,
        subtitle: `${urgency}${card.atRiskCount} concept${card.atRiskCount === 1 ? '' : 's'} at risk`,
        collectionId: c.id,
        priority: 70 + Math.min(card.dueCount, 20) + (card.daysUntilTarget !== null && card.daysUntilTarget <= 7 ? 15 : 0),
      });
    }

    if (card.nodeCount === 0) {
      suggestions.push({
        id: `capture-${c.id}`,
        type: 'start_capture',
        title: `Capture into ${c.title}`,
        subtitle: c.goal?.trim() || 'Scan or narrate to grow this map.',
        collectionId: c.id,
        priority: 60,
      });
    } else {
      const since = daysSince(c.lastSessionAt);
      if (since !== null && since >= 5) {
        suggestions.push({
          id: `stale-${c.id}`,
          type: 'capture_stale',
          title: `Continue ${c.title}`,
          subtitle: `No capture in ${since} days${c.goal ? ` · ${c.goal}` : ''}`,
          collectionId: c.id,
          priority: 40 + Math.min(since, 20),
        });
      }
    }

    if (card.atRiskCount >= 3 && card.nodeCount >= 5) {
      suggestions.push({
        id: `quiz-${c.id}`,
        type: 'quiz_weak',
        title: `Quiz weak areas · ${c.title}`,
        subtitle: `${card.atRiskCount} concepts fading — a short quiz will surface them.`,
        collectionId: c.id,
        priority: 50 + Math.min(card.atRiskCount, 15),
      });
    }
  }

  suggestions.sort((a, b) => b.priority - a.priority);

  return {
    stats: {
      ...stats,
      totalCollections: collections.length,
    },
    collections: cards,
    suggestions: suggestions.slice(0, 8),
    garden: {
      layoutVersion: 1,
      patches: layoutGardenPatches(cards),
      bridges: [],
    },
  };
}
