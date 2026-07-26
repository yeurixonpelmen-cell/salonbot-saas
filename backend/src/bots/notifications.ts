import { supabase } from '../db/client';
import { botManager } from './BotManager';
import { getUserBotLanguage, localeForLang, t } from './i18n';

export async function sendBookingNotifications(
  salonId: string,
  bookingId: string,
  clientTelegramId: number | null,
  clientName: string,
  clientPhone: string | null,
  datetime: string,
  serviceName: string,
  masterName: string,
  salonAddress: string,
  options: { requiresConfirmation?: boolean } = {}
): Promise<void> {
  const bot = botManager.getBotBySalonId(salonId);
  if (!bot) {
    console.warn(`No active bot found for salon ${salonId}; notification skipped`);
    return;
  }

  const dt = new Date(datetime);
  const { data: salon } = await supabase
    .from('salons')
    .select('admin_chat_id, require_booking_confirmation')
    .eq('id', salonId)
    .maybeSingle();

  const requiresConfirmation =
    options.requiresConfirmation ?? Boolean(salon?.require_booking_confirmation);

  if (clientTelegramId) {
    try {
      const lang = await getUserBotLanguage(salonId, clientTelegramId);
      const d = t(lang);
      const formatted = dt.toLocaleString(localeForLang(lang));
      const footer = requiresConfirmation ? `\n\n${d.awaitingConfirm}` : `\n\n${d.bookingConfirmedShort}`;
      await bot.api.sendMessage(
        clientTelegramId,
        `${d.bookingAccepted}\n📅 ${formatted}\n✂️ ${serviceName}\n👤 ${d.master}: ${masterName}\n📍 ${salonAddress}${footer}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: d.cancelBooking, callback_data: `cancel_${bookingId}` }]],
          },
        }
      );
    } catch (err) {
      console.error(`Client booking notification failed for ${bookingId}:`, err);
    }
  }

  if (!salon?.admin_chat_id) return;

  const source = clientTelegramId ? 'Telegram' : 'Сайт / Viber / Instagram';
  const formattedUk = dt.toLocaleString('uk-UA');
  const statusLine = requiresConfirmation
    ? '⏳ Потрібно підтвердити'
    : '✅ Підтверджено автоматично';
  const adminButtons = requiresConfirmation
    ? [
        [
          { text: '✅ Підтвердити', callback_data: `confirm_${bookingId}` },
          { text: '❌ Скасувати', callback_data: `admin_cancel_${bookingId}` },
        ],
      ]
    : [[{ text: '❌ Скасувати', callback_data: `admin_cancel_${bookingId}` }]];

  try {
    await bot.api.sendMessage(
      salon.admin_chat_id,
      `📅 НОВИЙ ЗАПИС (${source})\n${statusLine}\n👤 ${clientName} | 📞 ${clientPhone ?? '—'}\n✂️ ${serviceName} — ${masterName}\n🕐 ${formattedUk}`,
      {
        reply_markup: {
          inline_keyboard: adminButtons,
        },
      }
    );
  } catch (err) {
    console.error(`Admin booking notification failed for ${bookingId}:`, err);
  }
}
