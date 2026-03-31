import { Router } from 'express';
import { getAccessMap } from '../access.js';

/**
 * Creates the access router
 */
export function createAccessRouter(): Router {
  const router = Router();

  // GET /access - Get access map for frontend navigation filtering
  router.get('/access', (req, res) => {
    res.json(getAccessMap());
  });

  return router;
}