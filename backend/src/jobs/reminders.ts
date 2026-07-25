import cron from 'node-cron';
import { supabase } from '../db/client';
import { botManager } from '../bots/BotManager';
import {
  getUserBotLanguage,
  localeForLang,
  serviceDisplayName,
  t,
} from '../bots/i18n';

type SalonNotifySettings = {
  address?: string | null;
  reminders_enabled?: boolean | null;
  review_request_enabled?: boolean | null;
  google_maps_url?: string | null;
  name_uk?: string | null;
  name_en?: string | null;
  language?: string | null;
};

export function startReminderJobs(): void {
  if (process.env.CRON_ENABLED !== 'true') {
    console.log('Cron reminders disabled');
    return;
  }

  cron.schedule('*/15 * * * *', async () => {
    await sendReminders(24, 'reminder_24h_sent');
    await sendReminders(2, 'reminder_2h_sent');
    await sendReviewRequests();
  });

  console.log('Reminder cron started (every 15 min)');
}

async function sendReminders(
  hoursAhead: number,
  flagField: 'reminder_24h_sent' | 'reminder_2h_sent'
): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + (hoursAhead * 60 - 15) * 60 * 1000);
  const windowEnd = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  const { data: bookings } = await supabase
    .from('bookings')
    .select(
      'id, salon_id, client_telegram_id, booking_datetime, services(name_uk, name_en), masters(name), salons(address, reminders_enabled, language)'
    )
    .in('status', ['confirmed', 'pending'])
    .eq(flagField, false)
    .gte('booking_datetime', windowStart.toISOString())
    .lte('booking_datetime', windowEnd.toISOString());

  for (const b of bookings ?? []) {
    if (!b.client_telegram_id) continue;

    const salon = (Array.isArray(b.salons) ? b.salons[0] : b.salons) as SalonNotifySettings | null;
    if (salon?.reminders_enabled === false) continue;

    const bot = botManager.getBotBySalonId(b.salon_id);
    if (!bot) continue;

    const lang = await getUserBotLanguage(b.salon_id, b.client_telegram_id);
    const d = t(lang);
    const timeLabel = hoursAhead === 24 ? d.reminderTomorrow : d.reminderIn2h;

    const dt = new Date(b.booking_datetime);
    const service = Array.isArray(b.services) ? b.services[0] : b.services;
    const master = Array.isArray(b.masters) ? b.masters[0] : b.masters;
    const serviceName = serviceDisplayName(
      lang,
      service as { name_uk: string; name_en: string | null } | null
    );
    const masterName = (master as { name: string } | null | undefined)?.name ?? '';
    const address = salon?.address ?? '';
    const time = dt.toLocaleTimeString(localeForLang(lang), { hour: '2-digit', minute: '2-digit' });

    try {
      await bot.api.sendMessage(
        b.client_telegram_id,
        `${d.reminderTitle}\n${timeLabel} ${d.reminderBody(time)}\n✂️ ${serviceName}\n👤 ${d.master}: ${masterName}\n📍 ${address}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: d.cancelBooking, callback_data: `cancel_${b.id}` }]],
          },
        }
      );

      await supabase
        .from('bookings')
        .update({ [flagField]: true })
        .eq('id', b.id)
        .eq(flagField, false);
    } catch (err) {
      console.error(`Reminder failed for booking ${b.id}:`, err);
    }
  }
}

/** Ask for Google review ~1–3 hours after the visit ends. */
async function sendReviewRequests(): Promise<void> {
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - 8 * 60 * 60 * 1000);

  const { data: bookings } = await supabase
    .from('bookings')
    .select(
      'id, salon_id, client_telegram_id, booking_datetime, duration_minutes, visit_status, status, salons(review_request_enabled, google_maps_url, name_uk, name_en, language)'
    )
    .in('status', ['confirmed', 'pending', 'completed'])
    .neq('visit_status', 'refused')
    .eq('review_request_sent', false)
    .gte('booking_datetime', lookbackStart.toISOString())
    .lte('booking_datetime', now.toISOString());

  for (const b of bookings ?? []) {
    if (!b.client_telegram_id) continue;

    const salon = (Array.isArray(b.salons) ? b.salons[0] : b.salons) as SalonNotifySettings | null;

    if (!salon?.review_request_enabled) continue;
    const mapsUrl = salon.google_maps_url?.trim();
    if (!mapsUrl || !/^https?:\/\//i.test(mapsUrl)) continue;

    const start = new Date(b.booking_datetime).getTime();
    const end = start + Number(b.duration_minutes || 60) * 60_000;
    const hoursAfterEnd = (now.getTime() - end) / 3_600_000;
    if (hoursAfterEnd < 1 || hoursAfterEnd > 4) continue;

    const bot = botManager.getBotBySalonId(b.salon_id);
    if (!bot) continue;

    const lang = await getUserBotLanguage(b.salon_id, b.client_telegram_id);
    const d = t(lang);
    const salonName =
      lang === 'en' && salon.name_en?.trim()
        ? salon.name_en.trim()
        : salon.name_uk ?? 'us';

    try {
      await bot.api.sendMessage(b.client_telegram_id, d.reviewThanks(salonName), {
        reply_markup: {
          inline_keyboard: [[{ text: d.leaveReview, url: mapsUrl }]],
        },
      });

      await supabase
        .from('bookings')
        .update({ review_request_sent: true })
        .eq('id', b.id)
        .eq('review_request_sent', false);
    } catch (err) {
      console.error(`Review request failed for booking ${b.id}:`, err);
    }
  }
}
