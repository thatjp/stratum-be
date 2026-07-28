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

export interface HomePayload {
  stats: reviewStore.UserStats;
  collections: HomeCollectionCard[];
  suggestions: HomeSuggestion[];
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

export async function getHome(userId: string): Promise<HomePayload> {
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
    };
  }

  const ids = collections.map((c) => c.id);

  // Per-collection due counts (accepted artifacts currently due)
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

  // Per-nugget proficiency aggregates for avg / at-risk / samples
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
  };
}
