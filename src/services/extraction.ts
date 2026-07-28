import { z } from 'zod';
import { callClaudeJSON, DEFAULT_MODEL } from './claude';

const ArtifactSchema = z.object({
  kind:  z.enum(['flashcard', 'quiz_question', 'summary_bullet', 'action_item', 'vocab_card']),
  front: z.string().min(1).max(500),
  back:  z.string().min(1).max(500),
});

const NuggetSchema = z.object({
  content:    z.string().min(1),
  sourceText: z.string().default(''),
  confidence: z.number().min(0).max(1).default(1),
  artifacts:  z.array(ArtifactSchema).default([]),
});

const NuggetsSchema = z.array(NuggetSchema);

export type ExtractedNugget = z.infer<typeof NuggetSchema>;

const INTENT_INSTRUCTIONS: Record<string, string> = {
  study: `Generate flashcards and quiz questions. Focus on definitions, key concepts, and testable facts.
          Each nugget should map to one flashcard (front: question or term, back: answer or definition)
          and optionally one quiz question.`,
  work: `Generate summary bullets and action items. Focus on decisions, key insights, deadlines, and next steps.
         Each nugget should map to a summary bullet. If the text implies an action, also generate an action item.`,
  pleasure: `Generate summary bullets only. Focus on memorable ideas, quotes, and interesting insights.
             Keep it light — one bullet per key idea. No quizzes or flashcards.`,
};

export async function extractNuggets(
  text: string,
  intent: string,
  usage?: { userId?: string },
): Promise<ExtractedNugget[]> {
  const intentGuide = INTENT_INSTRUCTIONS[intent] ?? INTENT_INSTRUCTIONS.study;

  const { data } = await callClaudeJSON({
    schema:    NuggetsSchema,
    fallback:  [],
    model:     DEFAULT_MODEL(),
    maxTokens: 4096,
    usage:     { operation: 'extract_nuggets', userId: usage?.userId },
    system: `You are a knowledge extraction engine. Given a passage of text, extract atomic nuggets of knowledge
and generate study artifacts from them. Return ONLY valid JSON — no markdown, no explanation.

Intent context: ${intentGuide}

Return a JSON array of nuggets with this exact shape:
[
  {
    "content": "The atomic fact or concept in one or two sentences",
    "sourceText": "The verbatim sentence(s) from the passage this came from",
    "confidence": 0.95,
    "artifacts": [
      {
        "kind": "flashcard",
        "front": "What is X?",
        "back": "X is..."
      }
    ]
  }
]

Rules:
- Extract 3-8 nuggets per passage depending on density
- Each nugget must be genuinely atomic — one idea, not a summary of many
- confidence is 0.0-1.0 based on how clearly the passage supports this nugget
- Artifacts must match the intent context above
- front and back must each be under 300 characters
- If the text is too sparse or incoherent to extract nuggets, return []`,
    messages: [
      {
        role:    'user',
        content: `Extract knowledge nuggets from this passage:\n\n${text}`,
      },
    ],
  });

  return data;
}
