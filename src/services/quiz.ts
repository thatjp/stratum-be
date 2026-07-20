import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface GeneratedQuestion {
  question: string;
  expectedAnswer: string;
  nuggetId: string | null;
  artifactId: string | null;
}

export async function generateQuestions(params: {
  collectionId?: string | null;
  userId: string;
  count: number;
}): Promise<GeneratedQuestion[]> {
  // Pull nuggets (and their artifacts) to generate questions from
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

  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages:   [
      {
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
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.slice(0, params.count) : [];
  } catch {
    console.error('Failed to parse quiz generation response:', cleaned.slice(0, 200));
    return [];
  }
}

export async function gradeAnswer(params: {
  question: string;
  expectedAnswer: string;
  userAnswer: string;
}): Promise<{ isCorrect: boolean; feedback: string }> {
  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 256,
    messages:   [
      {
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
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      isCorrect: Boolean(parsed.isCorrect),
      feedback:  String(parsed.feedback ?? ''),
    };
  } catch {
    return { isCorrect: false, feedback: 'Unable to grade answer.' };
  }
}

export async function generatePerformanceOverview(params: {
  questions: Array<{ question: string; userAnswer: string | null; isCorrect: boolean | null; feedback: string | null }>;
  score: number;
  maxScore: number;
}): Promise<{ overview: string; weakNuggetIds: string[] }> {
  const summary = params.questions.map((q, i) =>
    `Q${i + 1}: ${q.question}\nAnswer: ${q.userAnswer ?? '(no answer)'}\nCorrect: ${q.isCorrect ? 'Yes' : 'No'}\nFeedback: ${q.feedback ?? ''}`,
  ).join('\n\n');

  const response = await client.messages.create({
    model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 512,
    messages:   [
      {
        role:    'user',
        content: `The user scored ${params.score}/${params.maxScore} on a quiz. Write a 2-3 sentence performance overview.
Be encouraging but honest. Highlight strengths and areas to revisit.

Quiz results:
${summary}

Return ONLY valid JSON:
{
  "overview": "The performance summary text"
}`,
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return { overview: String(parsed.overview ?? ''), weakNuggetIds: [] };
  } catch {
    return { overview: `You scored ${params.score} out of ${params.maxScore}.`, weakNuggetIds: [] };
  }
}
