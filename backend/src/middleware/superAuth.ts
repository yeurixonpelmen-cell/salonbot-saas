import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';

export function superAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = verifyJwt(header.slice(7));
  if (!payload || payload.role !== 'super') {
    res.status(401).json({ error: 'Super admin only' });
    return;
  }

  req.auth = payload;
  next();
}
