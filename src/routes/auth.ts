import { Router } from 'express';
import { isEmail } from 'validator';
import * as store from '../store/users';
import * as tokenStore from '../store/refreshTokens';
import { hashPassword, verifyPassword } from '../services/authCrypto';
import { signAccessToken, signRefreshToken, refreshTokenExpiry } from '../services/authTokens';
import { requireAuth } from '../middleware/requireAuth';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';

export const authRouter = Router();

authRouter.post('/register', asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'firstName is required');
  if (!lastName?.trim())  return sendError(res, 400, 'VALIDATION_ERROR', 'lastName is required');
  if (!email?.trim() || !isEmail(email)) return sendError(res, 400, 'VALIDATION_ERROR', 'valid email is required');
  if (!password || password.length < 8)  return sendError(res, 400, 'VALIDATION_ERROR', 'password must be at least 8 characters');

  let user;
  try {
    user = await store.createUser(email, await hashPassword(password), firstName, lastName);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return sendError(res, 409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw e;
  }

  const accessToken  = signAccessToken(user.id);
  const refreshToken = signRefreshToken();
  await tokenStore.saveRefreshToken(user.id, refreshToken, refreshTokenExpiry());
  res.status(201).json({ user, token: accessToken, refreshToken });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'email is required');
  if (!password)      return sendError(res, 400, 'VALIDATION_ERROR', 'password is required');

  const auth = await store.getUserAuthByEmail(email);
  if (!auth) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const ok = await verifyPassword(password, auth.passwordHash);
  if (!ok)   return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const user = await store.getUserById(auth.id);
  if (!user) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const accessToken  = signAccessToken(user.id);
  const refreshToken = signRefreshToken();
  await tokenStore.saveRefreshToken(user.id, refreshToken, refreshTokenExpiry());
  res.json({ user, token: accessToken, refreshToken });
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return sendError(res, 400, 'VALIDATION_ERROR', 'refreshToken is required');

  const record = await tokenStore.findAndDeleteRefreshToken(refreshToken);
  if (!record) return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired refresh token');

  const user = await store.getUserById(record.userId);
  if (!user) return sendError(res, 401, 'INVALID_TOKEN', 'User not found');

  const newAccessToken  = signAccessToken(user.id);
  const newRefreshToken = signRefreshToken();
  await tokenStore.saveRefreshToken(user.id, newRefreshToken, refreshTokenExpiry());
  res.json({ user, token: newAccessToken, refreshToken: newRefreshToken });
}));

authRouter.post('/logout', requireAuth, asyncHandler(async (_req, res) => {
  await tokenStore.deleteUserRefreshTokens(res.locals.userId!);
  res.status(204).send();
}));

authRouter.get('/me', requireAuth, asyncHandler(async (_req, res) => {
  const user = await store.getUserById(res.locals.userId!);
  if (!user) return sendError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  res.json({ user });
}));

authRouter.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const fields: Parameters<typeof store.updateUser>[1] = {};
  if (req.body.firstName !== undefined) fields.firstName = String(req.body.firstName);
  if (req.body.lastName  !== undefined) fields.lastName  = String(req.body.lastName);
  if (req.body.email     !== undefined) {
    if (!isEmail(String(req.body.email))) return sendError(res, 400, 'VALIDATION_ERROR', 'valid email is required');
    fields.email = String(req.body.email);
  }
  let user;
  try {
    user = await store.updateUser(res.locals.userId!, fields);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return sendError(res, 409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw e;
  }
  if (!user) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  res.json({ user });
}));

authRouter.delete('/me', requireAuth, asyncHandler(async (_req, res) => {
  await tokenStore.deleteUserRefreshTokens(res.locals.userId!);
  const deleted = await store.deleteUser(res.locals.userId!);
  if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  res.status(204).send();
}));
