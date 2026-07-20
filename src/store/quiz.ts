import { pool } from '../db';

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

export async function addQuizQuestion(params: {
  quizSessionId: string;
  nuggetId?: string | null;
  artifactId?: string | null;
  question: string;
  expectedAnswer: string;
}): Promise<QuizQuestion> {
  const { rows } = await pool.query(
    `INSERT INTO quiz_questions (quiz_session_id, nugget_id, artifact_id, question, expected_answer)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.quizSessionId, params.nuggetId ?? null, params.artifactId ?? null, params.question, params.expectedAnswer],
  );
  await pool.query(
    `UPDATE quiz_sessions SET question_count = question_count + 1, max_score = max_score + 1 WHERE id = $1`,
    [params.quizSessionId],
  );
  return rowToQuestion(rows[0]);
}

export async function getQuizQuestions(quizSessionId: string, userId: string): Promise<QuizQuestion[]> {
  // Verify ownership
  const session = await getQuizSession(quizSessionId, userId);
  if (!session) return [];
  const { rows } = await pool.query(
    `SELECT * FROM quiz_questions WHERE quiz_session_id = $1 ORDER BY created_at ASC`,
    [quizSessionId],
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
  // Verify ownership
  const session = await getQuizSession(params.quizSessionId, params.userId);
  if (!session) return null;

  const { rows } = await pool.query(
    `UPDATE quiz_questions
     SET user_answer = $1, is_correct = $2, feedback = $3
     WHERE id = $4 AND quiz_session_id = $5
     RETURNING *`,
    [params.userAnswer, params.isCorrect, params.feedback, params.questionId, params.quizSessionId],
  );
  if (!rows[0]) return null;

  if (params.isCorrect) {
    await pool.query(
      `UPDATE quiz_sessions SET score = score + 1 WHERE id = $1`,
      [params.quizSessionId],
    );
  }

  return rowToQuestion(rows[0]);
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
