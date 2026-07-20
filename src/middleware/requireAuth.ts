import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sendError } from './sendError';

interface TokenPayload {
  userId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Missing authorization header');
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
    res.locals.userId = payload.userId;
    next();
  } catch {
    return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}
