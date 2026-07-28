import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sendError } from './sendError';
import { asyncHandler } from './asyncHandler';
import * as store from '../store/users';

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
    // Pin the algorithm — without it, verify accepts any algorithm the token
    // header names, which is the shape of the classic JWT confusion attacks.
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as TokenPayload;
    res.locals.userId = payload.userId;
    next();
  } catch {
    return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

// Layer after requireAuth. Looks up the caller's current role on every
// request (roles can change without waiting for a token to expire) and
// rejects unless it's in the allowed set.
export function requireRole(...roles: store.UserRole[]) {
  return asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
    const role = await store.getUserRole(res.locals.userId!);
    if (!role || !roles.includes(role)) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
    res.locals.role = role;
    next();
  });
}
