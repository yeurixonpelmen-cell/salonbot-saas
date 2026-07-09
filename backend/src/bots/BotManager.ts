import { Bot, Context, webhookCallback } from 'grammy';
import { supabase } from '../db/client';
import { setupBotHandlers } from './handlers';

type ActiveSalonBot = {
  bot: Bot<Context>;
  salonId: string;
  token: string;
};

class BotManager {
  private bots = new Map<string, ActiveSalonBot>();
  private tokenBySalonId = new Map<string, string>();

  async initAllBots(): Promise<void> {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      console.error('ENCRYPTION_KEY not set');
      return;
    }

    const { data: salons, error } = await supabase.rpc('get_active_salons_decrypted', {
      p_key: key,
    });

    if (error) {
      console.error('Не вдалось завантажити список салонів:', error);
      return;
    }

    for (const salon of salons ?? []) {
      try {
        await this.addBot(salon.bot_token, salon.id);
      } catch (err) {
        console.error(`Не вдалось запустити бота для salon_id=${salon.id}:`, err);
      }
    }
  }

  async addBot(token: string, salonId: string): Promise<void> {
    if (this.tokenBySalonId.has(salonId)) return;

    const bot = new Bot(token);
    setupBotHandlers(bot, salonId);

    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl) {
      await bot.api.setWebhook(`${webhookUrl}/webhook/${salonId}`, {
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      });
    }

    this.bots.set(token, { bot, salonId, token });
    this.tokenBySalonId.set(salonId, token);
    console.log(`Bot started for salon ${salonId}`);
  }

  getWebhookHandler(salonId: string) {
    const token = this.tokenBySalonId.get(salonId);
    if (!token) return null;
    const activeBot = this.bots.get(token);
    if (!activeBot) return null;
    return webhookCallback(activeBot.bot, 'express');
  }

  getBotBySalonId(salonId: string): Bot<Context> | null {
    const token = this.tokenBySalonId.get(salonId);
    if (!token) return null;
    return this.bots.get(token)?.bot ?? null;
  }

  getSalonIdByToken(token: string): string | undefined {
    return this.bots.get(token)?.salonId;
  }

  hasBot(salonId: string): boolean {
    return this.tokenBySalonId.has(salonId);
  }

  async removeBot(salonId: string): Promise<void> {
    const token = this.tokenBySalonId.get(salonId);
    if (!token) return;

    const activeBot = this.bots.get(token);
    if (activeBot) {
      await activeBot.bot.api.deleteWebhook();
      this.bots.delete(token);
    }
    this.tokenBySalonId.delete(salonId);
  }
}

export const botManager = new BotManager();
