import { Router } from 'express';
import * as homeStore from '../store/home';
import { asyncHandler } from '../middleware/asyncHandler';

export const homeRouter = Router();

homeRouter.get('/', asyncHandler(async (_req, res) => {
  const home = await homeStore.getHome(res.locals.userId!);
  res.json(home);
}));
