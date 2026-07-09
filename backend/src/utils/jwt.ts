import jwt from 'jsonwebtoken';
import { JwtPayload } from '../db/types';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
const jwtExpiresIn = JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'];

export interface SalonSelectionPayload {
  owner_telegram_id: number;
  purpose: 'select_salon';
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: jwtExpiresIn });
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function signSalonSelectionJwt(ownerTelegramId: number): string {
  return jwt.sign(
    { owner_telegram_id: ownerTelegramId, purpose: 'select_salon' },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

export function verifySalonSelectionJwt(token: string): SalonSelectionPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as SalonSelectionPayload;
    if (payload.purpose !== 'select_salon') return null;
    return payload;
  } catch {
    return null;
  }
}
