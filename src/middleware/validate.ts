import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendError } from './sendError';

// Validates req.body against a zod schema. On success replaces req.body with
// the parsed (and coerced) value; on failure returns a 400 with the first issue.
export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path  = issue?.path.length ? issue.path.join('.') + ': ' : '';
      return sendError(res, 400, 'VALIDATION_ERROR', `${path}${issue?.message ?? 'Invalid request body'}`);
    }
    req.body = result.data;
    next();
  };
}

// Escape %, _, and \ so user-supplied search strings can't turn into wildcards.
export function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
