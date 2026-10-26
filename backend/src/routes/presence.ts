import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { findToken, recordEvent, presenceState } from '../presence.js';

export const presenceRouter = Router();

// POST /api/presence/events - zdarzenie z pluginu Claude Code albo bota (token biura, nie JWT)
presenceRouter.post('/events', (req: Request, res: Response) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? findToken(auth.substring(7)) : undefined;
  if (!token) {
    return res.status(401).json({ error: 'Nieprawidłowy token biura' });
  }
  try {
    recordEvent(token, req.body || {});
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: `Nieprawidłowe pole: ${(e as Error).message}` });
  }
});

// GET /api/presence/state - biuro widzi cały zespół (każda rola), bez stawek i zarobków
presenceRouter.get('/state', requireAuth, (req: Request, res: Response) => {
  res.json(presenceState());
});
