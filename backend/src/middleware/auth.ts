import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';
import { JwtPayload } from '../db/types';
import { supabase } from '../db/client';

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (!raw) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = verifyJwt(raw);
  if (!payload?.salon_id || payload.role === 'super') {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const { data: salon } = await supabase
    .from('salons')
    .select('id, is_active')
    .eq('id', payload.salon_id)
    .maybeSingle();

  if (!salon || salon.is_active === false) {
    res.status(401).json({ error: 'Салон видалено або вимкнено. Увійдіть знову.' });
    return;
  }

  req.auth = payload;
  next();
}
