import { supabase } from '../db/client';
import { botManager } from './BotManager';

export async function sendBookingNotifications(
  salonId: string,
  bookingId: string,
  clientTelegramId: number | null,
  clientName: string,
  clientPhone: string | null,
  datetime: string,
  serviceName: string,
  masterName: string,
  salonAddress: string
): Promise<void> {
  const bot = botManager.getBotBySalonId(salonId);
  if (!bot) {
    console.warn(`No active bot found for salon ${salonId}; notification skipped`);
    return;
  }

  const dt = new Date(datetime);
  const formatted = dt.toLocaleString('uk-UA');

  if (clientTelegramId) {
    try {
      await bot.api.sendMessage(
        clientTelegramId,
        `✅ Запис підтверджено!\n📅 ${formatted}\n✂️ ${serviceName}\n👤 Майстер: ${masterName}\n📍 ${salonAddress}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Скасувати запис', callback_data: `cancel_${bookingId}` }]],
          },
        }
      );
    } catch (err) {
      console.error(`Client booking notification failed for ${bookingId}:`, err);
    }
  }

  const { data: salon } = await supabase
    .from('salons')
    .select('admin_chat_id')
    .eq('id', salonId)
    .maybeSingle();

  if (!salon?.admin_chat_id) return;

  const source = clientTelegramId ? 'Telegram' : 'Сайт / Viber / Instagram';
  await bot.api.sendMessage(
    salon.admin_chat_id,
    `📅 НОВИЙ ЗАПИС (${source})\n👤 ${clientName} | 📞 ${clientPhone ?? '—'}\n✂️ ${serviceName} — ${masterName}\n🕐 ${formatted}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Підтвердити', callback_data: `confirm_${bookingId}` },
            { text: '❌ Скасувати', callback_data: `admin_cancel_${bookingId}` },
          ],
        ],
      },
    }
  );
}
