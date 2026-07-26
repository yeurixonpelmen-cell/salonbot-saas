import { Bot, Context } from 'grammy';
import { supabase } from '../db/client';
import { publishSalonBookingsChanged } from '../realtime/salonEvents';
import {
  getUserBotLanguage,
  languageKeyboard,
  localeForLang,
  normalizeBotLang,
  serviceDisplayName,
  setUserBotLanguage,
  t,
  type BotLang,
} from './i18n';

function normalizePublicUrl(raw: string | undefined, fallback: string): string {
  const value = (raw ?? fallback).trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  return `https://${value.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

async function replyBookingCta(ctx: Context, salonId: string, miniAppBase: string, lang: BotLang) {
  const d = t(lang);
  const webAppUrl = `${miniAppBase}?salon=${salonId}&lang=${lang}`;
  await ctx.reply(d.welcome, {
    reply_markup: {
      inline_keyboard: [[{ text: d.openBooking, web_app: { url: webAppUrl } }]],
    },
  });
}

async function replyWelcome(ctx: Context, salonId: string, miniAppBase: string, lang: BotLang) {
  const d = t(lang);
  await replyBookingCta(ctx, salonId, miniAppBase, lang);
  // Second message: language only (no duplicate catalog / intro in chat)
  await ctx.reply(d.chooseLanguage, { reply_markup: languageKeyboard(lang) });
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
      const lang = await getUserBotLanguage(salonId, ctx.from?.id);
      await replyWelcome(ctx, salonId, miniAppBase, lang);
    } catch (err) {
      console.error(`Failed /start reply (salon ${salonId}):`, err);
      try {
        const lang = await getUserBotLanguage(salonId, ctx.from?.id);
        await ctx.reply(t(lang).startFailed);
      } catch {
        // Ignore secondary Telegram errors.
      }
    }
  });

  bot.command('language', async (ctx) => {
    const lang = await getUserBotLanguage(salonId, ctx.from?.id);
    const d = t(lang);
    await ctx.reply(d.chooseLanguage, { reply_markup: languageKeyboard(lang) });
  });

  bot.command('mybookings', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const lang = await getUserBotLanguage(salonId, userId);
    const d = t(lang);

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, services(name_uk, name_en), masters(name)')
      .eq('client_telegram_id', userId)
      .eq('salon_id', salonId)
      .gt('booking_datetime', new Date().toISOString())
      .neq('status', 'cancelled')
      .order('booking_datetime');

    if (error) {
      console.error(`mybookings query failed (salon ${salonId}):`, error);
    }

    if (!bookings?.length) {
      await ctx.reply(d.noBookings);
      return;
    }

    const lines = bookings.map((b) => {
      const dt = new Date(b.booking_datetime);
      const service = serviceDisplayName(
        lang,
        b.services as { name_uk: string; name_en: string | null } | null
      );
      const master = (b.masters as { name: string } | null)?.name ?? '';
      const status = d.statusLabels[b.status] ?? b.status;
      return `📅 ${dt.toLocaleString(localeForLang(lang))}\n✂️ ${service}\n👤 ${master}\n${d.status}: ${status}`;
    });

    await ctx.reply(lines.join('\n\n'));
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) return;

    if (data.startsWith('lang_')) {
      const next = normalizeBotLang(data.slice('lang_'.length));
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.answerCallbackQuery();
        return;
      }
      await setUserBotLanguage(salonId, userId, next);
      const d = t(next);
      await ctx.answerCallbackQuery({ text: d.languageSaved });
      // Only refresh booking CTA — don't spam another language picker
      await replyBookingCta(ctx, salonId, miniAppBase, next);
      return;
    }

    const lang = await getUserBotLanguage(salonId, ctx.from?.id);
    const d = t(lang);

    if (data.startsWith('admin_cancel_')) {
      const bookingId = data.slice('admin_cancel_'.length);
      const isAllowed = await ensureAdminCallback(ctx.chat?.id, salonId);
      if (!isAllowed) {
        await ctx.answerCallbackQuery({ text: d.insufficientRights, show_alert: true });
        return;
      }

      const updated = await updateBookingStatus(bookingId, salonId, 'cancelled');
      if (!updated) {
        await ctx.answerCallbackQuery({ text: d.bookingNotFound, show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: d.bookingCancelled.replace('❌ ', '') });
      await safeEditMessage(ctx, d.bookingCancelledAdmin);
      return;
    }

    if (data.startsWith('confirm_')) {
      const bookingId = data.slice('confirm_'.length);
      const isAllowed = await ensureAdminCallback(ctx.chat?.id, salonId);
      if (!isAllowed) {
        await ctx.answerCallbackQuery({ text: d.insufficientRights, show_alert: true });
        return;
      }

      const updated = await updateBookingStatus(bookingId, salonId, 'confirmed');
      if (!updated) {
        await ctx.answerCallbackQuery({ text: d.bookingNotFound, show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: d.bookingConfirmed.replace('✅ ', '') });
      await safeEditMessage(ctx, d.bookingConfirmed);
      return;
    }

    if (data.startsWith('cancel_')) {
      const bookingId = data.slice('cancel_'.length);
      const isOwner = await ensureCustomerCallback(ctx.from?.id, bookingId, salonId);
      if (!isOwner) {
        await ctx.answerCallbackQuery({ text: d.insufficientRights, show_alert: true });
        return;
      }

      const updated = await updateBookingStatus(bookingId, salonId, 'cancelled');
      if (!updated) {
        await ctx.answerCallbackQuery({ text: d.bookingNotFound, show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: d.bookingCancelled.replace('❌ ', '') });
      await safeEditMessage(ctx, d.bookingCancelled);
      return;
    }

    await ctx.answerCallbackQuery();
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
  if (data) publishSalonBookingsChanged(salonId);
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
