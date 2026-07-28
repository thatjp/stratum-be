import { pool, withTransaction } from '../db';

export interface QuizSession {
  id: string;
  userId: string;
  collectionId: string | null;
  mode: 'inline' | 'final';
  questionCount: number;
  score: number;
  maxScore: number;
  performanceOverview: string | null;
  weakNuggetIds: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface QuizQuestion {
  id: string;
  quizSessionId: string;
  nuggetId: string | null;
  artifactId: string | null;
  question: string;
  expectedAnswer: string;
  userAnswer: string | null;
  isCorrect: boolean | null;
  feedback: string | null;
  createdAt: string;
}

function rowToSession(r: Record<string, unknown>): QuizSession {
  return {
    id:                  r.id as string,
    userId:              r.user_id as string,
    collectionId:        r.collection_id as string | null,
    mode:                r.mode as QuizSession['mode'],
    questionCount:       r.question_count as number,
    score:               r.score as number,
    maxScore:            r.max_score as number,
    performanceOverview: r.performance_overview as string | null,
    weakNuggetIds:       (r.weak_nugget_ids as string[]) ?? [],
    createdAt:           r.created_at as string,
    completedAt:         r.completed_at as string | null,
  };
}

function rowToQuestion(r: Record<string, unknown>): QuizQuestion {
  return {
    id:             r.id as string,
    quizSessionId:  r.quiz_session_id as string,
    nuggetId:       r.nugget_id as string | null,
    artifactId:     r.artifact_id as string | null,
    question:       r.question as string,
    expectedAnswer: r.expected_answer as string,
    userAnswer:     r.user_answer as string | null,
    isCorrect:      r.is_correct as boolean | null,
    feedback:       r.feedback as string | null,
    createdAt:      r.created_at as string,
  };
}

export async function createQuizSession(params: {
  userId: string;
  collectionId?: string | null;
  mode: QuizSession['mode'];
}): Promise<QuizSession> {
  const { rows } = await pool.query(
    `INSERT INTO quiz_sessions (user_id, collection_id, mode) VALUES ($1, $2, $3) RETURNING *`,
    [params.userId, params.collectionId ?? null, params.mode],
  );
  return rowToSession(rows[0]);
}

export async function getQuizSession(id: string, userId: string): Promise<QuizSession | null> {
  const { rows } = await pool.query(
    `SELECT * FROM quiz_sessions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0] ? rowToSession(rows[0]) : null;
}

export async function listQuizSessions(userId: string, collectionId?: string): Promise<QuizSession[]> {
  if (collectionId) {
    const { rows } = await pool.query(
      `SELECT * FROM quiz_sessions WHERE user_id = $1 AND collection_id = $2 ORDER BY created_at DESC`,
      [userId, collectionId],
    );
    return rows.map(rowToSession);
  }
  const { rows } = await pool.query(
    `SELECT * FROM quiz_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
  return rows.map(rowToSession);
}

// Inserts every question in one round trip and bumps the session counters once,
// instead of two statements per question all contending on the same session row.
export async function addQuizQuestions(
  quizSessionId: string,
  questions: Array<{
    nuggetId?: string | null;
    artifactId?: string | null;
    question: string;
    expectedAnswer: string;
  }>,
): Promise<QuizQuestion[]> {
  if (!questions.length) return [];

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO quiz_questions (quiz_session_id, nugget_id, artifact_id, question, expected_answer)
       SELECT $1, q.nugget_id, q.artifact_id, q.question, q.expected_answer
       FROM UNNEST($2::uuid[], $3::uuid[], $4::text[], $5::text[])
         AS q(nugget_id, artifact_id, question, expected_answer)
       RETURNING *`,
      [
        quizSessionId,
        questions.map((q) => q.nuggetId ?? null),
        questions.map((q) => q.artifactId ?? null),
        questions.map((q) => q.question),
        questions.map((q) => q.expectedAnswer),
      ],
    );

    await client.query(
      `UPDATE quiz_sessions
       SET question_count = question_count + $2, max_score = max_score + $2
       WHERE id = $1`,
      [quizSessionId, rows.length],
    );

    return rows.map(rowToQuestion);
  });
}

// Ownership is enforced by the join rather than a preceding SELECT, so this is
// one round trip instead of two. Returns [] for a session the user doesn't own.
export async function getQuizQuestions(quizSessionId: string, userId: string): Promise<QuizQuestion[]> {
  const { rows } = await pool.query(
    `SELECT q.* FROM quiz_questions q
     JOIN quiz_sessions s ON s.id = q.quiz_session_id
     WHERE q.quiz_session_id = $1 AND s.user_id = $2
     ORDER BY q.created_at ASC`,
    [quizSessionId, userId],
  );
  return rows.map(rowToQuestion);
}

export async function gradeQuestion(params: {
  questionId: string;
  quizSessionId: string;
  userId: string;
  userAnswer: string;
  isCorrect: boolean;
  feedback: string;
}): Promise<QuizQuestion | null> {
  return withTransaction(async (client) => {
    // Ownership is part of the UPDATE's predicate, so no separate check is
    // needed and the grade cannot be applied to someone else's question.
    const { rows } = await client.query(
      `UPDATE quiz_questions q
       SET user_answer = $1, is_correct = $2, feedback = $3
       FROM quiz_sessions s
       WHERE q.id = $4
         AND q.quiz_session_id = $5
         AND s.id = q.quiz_session_id
         AND s.user_id = $6
       RETURNING q.*`,
      [params.userAnswer, params.isCorrect, params.feedback,
       params.questionId, params.quizSessionId, params.userId],
    );
    if (!rows[0]) return null;

    // Same transaction as the grade — otherwise a crash between the two leaves
    // the question marked correct but the session score behind.
    if (params.isCorrect) {
      await client.query(
        `UPDATE quiz_sessions SET score = score + 1 WHERE id = $1`,
        [params.quizSessionId],
      );
    }

    return rowToQuestion(rows[0]);
  });
}

export async function completeQuizSession(params: {
  quizSessionId: string;
  userId: string;
  performanceOverview: string;
  weakNuggetIds: string[];
}): Promise<QuizSession | null> {
  const { rows } = await pool.query(
    `UPDATE quiz_sessions
     SET completed_at = NOW(), performance_overview = $1, weak_nugget_ids = $2::uuid[]
     WHERE id = $3 AND user_id = $4
     RETURNING *`,
    [params.performanceOverview, params.weakNuggetIds, params.quizSessionId, params.userId],
  );
  return rows[0] ? rowToSession(rows[0]) : null;
}
