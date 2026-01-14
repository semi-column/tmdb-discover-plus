import { Router } from 'express';
import { apiRouter, getUserConfig } from '../services/userConfig.js';

const router = Router();

// Re-export API routes
router.use('/', apiRouter);

export { router as apiRouter };
