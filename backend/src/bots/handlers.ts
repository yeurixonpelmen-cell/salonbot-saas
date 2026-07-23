import { Bot, Context } from 'grammy';
import { supabase } from '../db/client';

function normalizePublicUrl(raw: string | undefined, fallback: string): string {
  const value = (raw ?? fallback).trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  return `https://${value.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

export function setupBotHandlers(bot: Bot, salonId: string): void {
  const miniAppBase = normalizePublicUrl(
    process.env.MINI_APP_URL,
    'http://localhost:5173'
  );

  bot.catch((err) => {
    console.error(`Bot handler error (salon ${salonId}):`, err);
  });

  bot.command('start', async (ctx) => {
    try {
      const webAppUrl = `${miniAppBase}?salon=${salonId}`;
      await ctx.reply(
        'Ласкаво просимо! 👋\nОзнайомтесь із салоном і спеціалістами — і перейдіть до запису, коли будете готові.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '✨ Ознайомитись / Перейти до запису', web_app: { url: webAppUrl } }]],
          },
        }
      );
    } catch (err) {
      console.error(`Failed /start reply (salon ${salonId}):`, err);
      try {
        await ctx.reply('Не вдалось відкрити запис онлайн. Спробуйте пізніше.');
      } catch {
        // Ignore secondary Telegram errors.
      }
    }
  });

  bot.command('mybookings', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { data: bookings } = await supabase
      .from('bookings')
      .select('*, services(name_uk), masters(name)')
      .eq('client_telegram_id', userId)
      .eq('salon_id', salonId)
      .gt('booking_datetime', new Date().toISOString())
      .neq('status', 'cancelled')
      .order('booking_datetime');

    if (!bookings?.length) {
      await ctx.reply('У вас немає активних записів.');
      return;
    }

    const lines = bookings.map((b) => {
      const dt = new Date(b.booking_datetime);
      const service = (b.services as { name_uk: string } | null)?.name_uk ?? '';
      const master = (b.masters as { name: string } | null)?.name ?? '';
      return `📅 ${dt.toLocaleString('uk-UA')}\n✂️ ${service}\n👤 ${master}\nСтатус: ${b.status}`;
    });

    await ctx.reply(lines.join('\n\n'));
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) return;

    if (data.startsWith('cancel_')) {
      const bookingId = data.replace('cancel_', '');
      const isOwner = await ensureCustomerCallback(ctx.from?.id, bookingId, salonId);
      if (!isOwner) {
        await ctx.answerCallbackQuery({ text: 'Недостатньо прав', show_alert: true });
        return;
      }

      const updated = await updateBookingStatus(bookingId, salonId, 'cancelled');
      if (!updated) {
        await ctx.answerCallbackQuery({ text: 'Запис не знайдено', show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Запис скасовано' });
      await safeEditMessage(ctx, '❌ Запис скасовано.');
      return;
    }

    if (data.startsWith('confirm_')) {
      const bookingId = data.replace('confirm_', '');
      const isAllowed = await ensureAdminCallback(ctx.chat?.id, salonId);
      if (!isAllowed) {
        await ctx.answerCallbackQuery({ text: 'Недостатньо прав', show_alert: true });
        return;
      }

      const updated = await updateBookingStatus(bookingId, salonId, 'confirmed');
      if (!updated) {
        await ctx.answerCallbackQuery({ text: 'Запис не знайдено', show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Запис підтверджено' });
      await safeEditMessage(ctx, '✅ Запис підтверджено.');
      return;
    }

    if (data.startsWith('admin_cancel_')) {
      const bookingId = data.replace('admin_cancel_', '');
      const isAllowed = await ensureAdminCallback(ctx.chat?.id, salonId);
      if (!isAllowed) {
        await ctx.answerCallbackQuery({ text: 'Недостатньо прав', show_alert: true });
        return;
      }

      const updated = await updateBookingStatus(bookingId, salonId, 'cancelled');
      if (!updated) {
        await ctx.answerCallbackQuery({ text: 'Запис не знайдено', show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Запис скасовано' });
      await safeEditMessage(ctx, '❌ Запис скасовано адміністратором.');
    }
  });
}

async function updateBookingStatus(
  bookingId: string,
  salonId: string,
  status: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', bookingId)
    .eq('salon_id', salonId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(`Failed to update booking ${bookingId}:`, error);
    return false;
  }
  return Boolean(data);
}

async function ensureAdminCallback(chatId: number | undefined, salonId: string): Promise<boolean> {
  if (!chatId) return false;

  const { data: salon, error } = await supabase
    .from('salons')
    .select('admin_chat_id')
    .eq('id', salonId)
    .maybeSingle();

  if (error || !salon?.admin_chat_id) return false;
  return String(chatId) === String(salon.admin_chat_id);
}

async function ensureCustomerCallback(
  userId: number | undefined,
  bookingId: string,
  salonId: string
): Promise<boolean> {
  if (!userId) return false;

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('client_telegram_id')
    .eq('id', bookingId)
    .eq('salon_id', salonId)
    .maybeSingle();

  if (error || !booking) return false;
  return Number(booking.client_telegram_id) === userId;
}

async function safeEditMessage(ctx: Context, text: string) {
  try {
    await ctx.editMessageText(text);
  } catch {
    // Telegram can reject edits for old or already edited messages; callback has still succeeded.
  }
}
