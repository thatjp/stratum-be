import { Router } from 'express';
import { z } from 'zod';
import * as store from '../store/users';
import * as tokenStore from '../store/refreshTokens';
import { hashPassword, verifyPassword } from '../services/authCrypto';
import { signAccessToken, signRefreshToken, refreshTokenExpiry } from '../services/authTokens';
import { requireAuth } from '../middleware/requireAuth';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendError } from '../middleware/sendError';
import { validateBody } from '../middleware/validate';

export const authRouter = Router();

const RegisterSchema = z.object({
  firstName: z.string().trim().min(1, 'firstName is required').max(100),
  lastName:  z.string().trim().min(1, 'lastName is required').max(100),
  email:     z.string().trim().email('valid email is required').max(254),
  password:  z.string().min(8, 'password must be at least 8 characters').max(200),
});

const LoginSchema = z.object({
  email:    z.string().trim().min(1, 'email is required').max(254),
  password: z.string().min(1, 'password is required').max(200),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

const UpdateMeSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName:  z.string().trim().min(1).max(100).optional(),
  email:     z.string().trim().email('valid email is required').max(254).optional(),
}).refine((v) => v.firstName !== undefined || v.lastName !== undefined || v.email !== undefined, {
  message: 'At least one field is required',
});

authRouter.post('/register', validateBody(RegisterSchema), asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password } = req.body as z.infer<typeof RegisterSchema>;

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

authRouter.post('/login', validateBody(LoginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body as z.infer<typeof LoginSchema>;

  // Run the comparison even when the lookup missed, so an unregistered email
  // and a wrong password take the same amount of time to reject.
  const auth = await store.getUserAuthByEmail(email);
  const ok   = await verifyPassword(password, auth?.passwordHash);
  if (!auth || !ok) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const user = await store.getUserById(auth.id);
  if (!user) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const accessToken  = signAccessToken(user.id);
  const refreshToken = signRefreshToken();
  await tokenStore.saveRefreshToken(user.id, refreshToken, refreshTokenExpiry());
  res.json({ user, token: accessToken, refreshToken });
}));

authRouter.post('/refresh', validateBody(RefreshSchema), asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;

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

authRouter.patch('/me', requireAuth, validateBody(UpdateMeSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof UpdateMeSchema>;
  const fields: Parameters<typeof store.updateUser>[1] = {};
  if (body.firstName !== undefined) fields.firstName = body.firstName;
  if (body.lastName  !== undefined) fields.lastName  = body.lastName;
  if (body.email     !== undefined) fields.email     = body.email;
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
