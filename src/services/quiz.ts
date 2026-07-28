import { z } from 'zod';
import { pool } from '../db';
import { callClaudeJSON, DEFAULT_MODEL } from './claude';

export interface GeneratedQuestion {
  question: string;
  expectedAnswer: string;
  nuggetId: string | null;
  artifactId: string | null;
}

const GeneratedQuestionsSchema = z.array(z.object({
  question:       z.string().min(1),
  expectedAnswer: z.string().min(1),
  nuggetId:       z.string().nullable().optional().default(null),
  artifactId:     z.string().nullable().optional().default(null),
}));

const GradeSchema = z.object({
  isCorrect: z.boolean(),
  feedback:  z.string().default(''),
});

const OverviewSchema = z.object({
  overview: z.string().min(1),
});

export async function generateQuestions(params: {
  collectionId?: string | null;
  userId: string;
  count: number;
}): Promise<GeneratedQuestion[]> {
  let nuggetRows: Array<Record<string, unknown>>;
  if (params.collectionId) {
    const { rows } = await pool.query(
      `SELECT n.id AS nugget_id, n.content, a.id AS artifact_id, a.front, a.back, a.kind
       FROM nuggets n
       LEFT JOIN artifacts a ON a.nugget_id = n.id AND a.status = 'accepted'
       WHERE n.collection_id = $1 AND n.user_id = $2
       ORDER BY RANDOM()
       LIMIT $3`,
      [params.collectionId, params.userId, params.count * 2],
    );
    nuggetRows = rows;
  } else {
    const { rows } = await pool.query(
      `SELECT n.id AS nugget_id, n.content, a.id AS artifact_id, a.front, a.back, a.kind
       FROM nuggets n
       LEFT JOIN artifacts a ON a.nugget_id = n.id AND a.status = 'accepted'
       WHERE n.user_id = $1
       ORDER BY RANDOM()
       LIMIT $2`,
      [params.userId, params.count * 2],
    );
    nuggetRows = rows;
  }

  if (!nuggetRows.length) return [];

  const nuggetText = nuggetRows.map((r) => {
    const artifact = r.artifact_id
      ? `  Flashcard Q: ${r.front as string}\n  Flashcard A: ${r.back as string}`
      : '';
    return `- [nugget_id: ${r.nugget_id as string}] ${r.content as string}${artifact ? '\n' + artifact : ''}`;
  }).join('\n');

  const { data } = await callClaudeJSON({
    schema:    GeneratedQuestionsSchema,
    fallback:  [],
    model:     DEFAULT_MODEL(),
    maxTokens: 2048,
    usage:     { operation: 'quiz_generate', userId: params.userId },
    messages:  [{
      role:    'user',
      content: `Generate exactly ${params.count} quiz questions from these knowledge nuggets.
Return ONLY valid JSON — no markdown, no explanation.

Nuggets:
${nuggetText}

Return a JSON array with this exact shape:
[
  {
    "question": "The question to ask the user",
    "expectedAnswer": "The ideal answer",
    "nuggetId": "the nugget_id this question is based on or null",
    "artifactId": null
  }
]

Rules:
- Each question must test a distinct concept — no duplicates
- Questions should be clear and answerable in 1-3 sentences
- expectedAnswer should be concise (under 200 characters)
- Vary question types: definition, application, comparison, recall
- Return exactly ${params.count} items`,
    }],
  });

  return data.slice(0, params.count).map((q) => ({
    question:       q.question,
    expectedAnswer: q.expectedAnswer,
    nuggetId:       q.nuggetId ?? null,
    artifactId:     q.artifactId ?? null,
  }));
}

// Shared by both the standalone quiz routes and the in-conversation quiz flow.
export async function gradeAnswer(params: {
  question: string;
  expectedAnswer: string;
  userAnswer: string;
  userId?: string;
  conversationId?: string;
}): Promise<{ isCorrect: boolean; feedback: string }> {
  const { data } = await callClaudeJSON({
    schema:    GradeSchema,
    fallback:  { isCorrect: false, feedback: 'Unable to grade answer.' },
    model:     DEFAULT_MODEL(),
    maxTokens: 256,
    usage:     {
      operation:      'quiz_grade',
      userId:         params.userId,
      conversationId: params.conversationId,
    },
    messages: [{
      role:    'user',
      content: `Grade this quiz answer. Return ONLY valid JSON.

Question: ${params.question}
Expected answer: ${params.expectedAnswer}
User's answer: ${params.userAnswer}

Return:
{
  "isCorrect": true or false,
  "feedback": "1-2 sentence explanation. If incorrect, explain why and give the right answer briefly."
}

Be generous — mark correct if the user captures the essential meaning even if not word-for-word.`,
    }],
  });

  return data;
}

// Shared quiz-summary prompt used by both quiz systems. Callers map the
// returned overview into their own response shape (and compute weak nuggets).
export async function summarizeQuizPerformance(params: {
  questions: Array<{
    question: string;
    userAnswer: string | null;
    isCorrect: boolean | null;
    feedback: string | null;
  }>;
  score: number;
  maxScore: number;
  userId?: string;
  conversationId?: string;
}): Promise<string> {
  const summary = params.questions.map((q, i) =>
    `Q${i + 1}: ${q.question}\nAnswer: ${q.userAnswer ?? '(no answer)'}\nCorrect: ${q.isCorrect ? 'Yes' : 'No'}\nFeedback: ${q.feedback ?? ''}`,
  ).join('\n\n');

  const fallback = `You scored ${params.score} out of ${params.maxScore}.`;

  const { data } = await callClaudeJSON({
    schema:    OverviewSchema,
    fallback:  { overview: fallback },
    model:     DEFAULT_MODEL(),
    maxTokens: 512,
    usage:     {
      operation:      'quiz_summary',
      userId:         params.userId,
      conversationId: params.conversationId,
    },
    messages: [{
      role:    'user',
      content: `The user scored ${params.score}/${params.maxScore} on a quiz. Write a 2-3 sentence performance overview.
Be encouraging but honest. Highlight strengths and areas to revisit.

Quiz results:
${summary}

Return ONLY valid JSON:
{
  "overview": "The performance summary text"
}`,
    }],
  });

  return data.overview || fallback;
}

export async function generatePerformanceOverview(params: {
  questions: Array<{ question: string; userAnswer: string | null; isCorrect: boolean | null; feedback: string | null }>;
  score: number;
  maxScore: number;
  userId?: string;
}): Promise<{ overview: string; weakNuggetIds: string[] }> {
  const overview = await summarizeQuizPerformance(params);
  return { overview, weakNuggetIds: [] };
}
