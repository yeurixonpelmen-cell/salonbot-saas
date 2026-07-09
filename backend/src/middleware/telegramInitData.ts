import { Request, Response, NextFunction } from 'express';
import { getTelegramUserFromInitData, validateTelegramData } from '../utils/telegram';
import { getSalonBotToken } from '../utils/salon';

declare global {
  namespace Express {
    interface Request {
      telegramUser?: {
        id: number;
        first_name?: string;
        language_code?: string;
      };
    }
  }
}

export async function telegramInitDataMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const initData = req.headers['x-telegram-init-data'] as string | undefined;
  if (!initData) {
    res.status(401).json({ error: 'Invalid Telegram data' });
    return;
  }

  const salonId =
    (req.params.salonId as string) ||
    (req.body?.salonId as string) ||
    (req.query.salonId as string);

  if (!salonId) {
    res.status(400).json({ error: 'salonId required' });
    return;
  }

  const botToken = await getSalonBotToken(salonId);
  if (!botToken || !validateTelegramData(initData, botToken)) {
    res.status(401).json({ error: 'Invalid Telegram data' });
    return;
  }

  const telegramUser = getTelegramUserFromInitData(initData);
  if (!telegramUser?.id) {
    res.status(401).json({ error: 'Invalid Telegram data' });
    return;
  }

  req.telegramUser = telegramUser;
  next();
}
