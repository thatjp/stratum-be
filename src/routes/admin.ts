import { Router } from 'express';
import * as usersStore from '../store/users';
import * as adminStore from '../store/admin';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';
import { requireRole } from '../middleware/requireAuth';

export const adminRouter = Router();

// Role management is admin-only; everything else here is readable by support too.
const requireAdmin = requireRole('admin');

function parseSince(value: unknown): Date | undefined {
  if (!value) return undefined;
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ---- Users ----

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10), 0);
  const search = req.query.search ? String(req.query.search) : undefined;
  const result = await usersStore.listUsers({ search, limit, offset });
  res.json(result);
}));

adminRouter.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await usersStore.getUserById(String(req.params.id));
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  res.json({ user });
}));

adminRouter.patch('/users/:id/role', requireAdmin, asyncHandler(async (req, res) => {
  const role = String(req.body.role ?? '');
  if (!['user', 'support', 'admin'].includes(role)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'role must be user, support, or admin');
  }
  const user = await usersStore.setUserRole(String(req.params.id), role as usersStore.UserRole);
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  res.json({ user });
}));

adminRouter.delete('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const deleted = await usersStore.deleteUser(String(req.params.id));
  if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  res.status(204).send();
}));

// ---- Claude usage ----

adminRouter.get('/usage', asyncHandler(async (req, res) => {
  const since = parseSince(req.query.sinceDays);
  const [summary, byModel, topUsers] = await Promise.all([
    adminStore.getUsageSummary({ since }),
    adminStore.getUsageByModel({ since }),
    adminStore.getTopUsersByUsage({ since, limit: 20 }),
  ]);
  res.json({ summary, byModel, topUsers });
}));

// ---- Pipeline health ----

adminRouter.get('/pipeline', asyncHandler(async (req, res) => {
  const olderThanMinutes = Math.max(parseInt(String(req.query.olderThanMinutes ?? '30'), 10), 1);
  const [stuckSessions, stuckCaptures] = await Promise.all([
    adminStore.getStuckSessions(olderThanMinutes),
    adminStore.getStuckCaptures(olderThanMinutes),
  ]);
  res.json({ stuckSessions, stuckCaptures });
}));

// ---- Content moderation ----

adminRouter.get('/artifacts/pending', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10), 0);
  const result = await adminStore.getPendingArtifacts({ limit, offset });
  res.json(result);
}));
