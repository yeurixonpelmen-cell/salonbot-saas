import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';
import { JwtPayload } from '../db/types';

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = verifyJwt(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.auth = payload;
  next();
}
