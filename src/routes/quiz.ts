import { Router } from 'express';
import * as quizStore from '../store/quiz';
import * as quizService from '../services/quiz';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const quizRouter = Router();

// List quiz sessions
quizRouter.get('/', asyncHandler(async (req, res) => {
  const collectionId = req.query.collectionId ? String(req.query.collectionId) : undefined;
  const sessions = await quizStore.listQuizSessions(res.locals.userId!, collectionId);
  res.json({ sessions });
}));

// Create a new quiz session and generate questions
quizRouter.post('/', asyncHandler(async (req, res) => {
  const mode         = String(req.body.mode ?? 'inline');
  const collectionId = req.body.collectionId ? String(req.body.collectionId) : null;
  const count        = Math.min(Math.max(Number(req.body.count ?? 5), 1), 20);

  if (!['inline', 'final'].includes(mode)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'mode must be inline or final');
  }

  const session = await quizStore.createQuizSession({
    userId: res.locals.userId!,
    collectionId,
    mode:   mode as 'inline' | 'final',
  });

  const generated = await quizService.generateQuestions({
    collectionId,
    userId: res.locals.userId!,
    count,
  });

  if (!generated.length) {
    return sendError(res, 422, 'INSUFFICIENT_CONTENT', 'Not enough content to generate quiz questions. Add more captures first.');
  }

  const questions = await Promise.all(
    generated.map((q) =>
      quizStore.addQuizQuestion({
        quizSessionId:  session.id,
        nuggetId:       q.nuggetId,
        artifactId:     q.artifactId,
        question:       q.question,
        expectedAnswer: q.expectedAnswer,
      }),
    ),
  );

  res.status(201).json({ session, questions });
}));

// Get quiz session + questions
quizRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const session = await quizStore.getQuizSession(id, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Quiz session not found');

  const questions = await quizStore.getQuizQuestions(id, res.locals.userId!);
  res.json({ session, questions });
}));

// Grade a question answer (text or audio transcript)
quizRouter.post('/:id/questions/:questionId/grade', asyncHandler(async (req, res) => {
  const quizSessionId = String(req.params.id);
  const questionId    = String(req.params.questionId);
  const userAnswer    = String(req.body.answer ?? '').trim();

  if (!userAnswer) return sendError(res, 400, 'VALIDATION_ERROR', 'Answer is required');

  const session = await quizStore.getQuizSession(quizSessionId, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Quiz session not found');

  const questions = await quizStore.getQuizQuestions(quizSessionId, res.locals.userId!);
  const question  = questions.find((q) => q.id === questionId);
  if (!question) return sendError(res, 404, 'NOT_FOUND', 'Question not found');

  const { isCorrect, feedback } = await quizService.gradeAnswer({
    question:       question.question,
    expectedAnswer: question.expectedAnswer,
    userAnswer,
  });

  const graded = await quizStore.gradeQuestion({
    questionId,
    quizSessionId,
    userId:    res.locals.userId!,
    userAnswer,
    isCorrect,
    feedback,
  });

  res.json({ question: graded, isCorrect, feedback });
}));

// Complete quiz session (generate overview)
quizRouter.post('/:id/complete', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const session = await quizStore.getQuizSession(id, res.locals.userId!);
  if (!session) return sendError(res, 404, 'NOT_FOUND', 'Quiz session not found');
  if (session.completedAt) return sendError(res, 409, 'ALREADY_COMPLETED', 'Quiz already completed');

  const questions = await quizStore.getQuizQuestions(id, res.locals.userId!);

  const { overview, weakNuggetIds } = await quizService.generatePerformanceOverview({
    questions: questions.map((q) => ({
      question:    q.question,
      userAnswer:  q.userAnswer,
      isCorrect:   q.isCorrect,
      feedback:    q.feedback,
    })),
    score:    session.score,
    maxScore: session.maxScore,
  });

  const completed = await quizStore.completeQuizSession({
    quizSessionId:       id,
    userId:              res.locals.userId!,
    performanceOverview: overview,
    weakNuggetIds,
  });

  res.json({ session: completed, questions });
}));
