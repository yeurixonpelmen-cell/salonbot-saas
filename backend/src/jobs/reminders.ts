import cron from 'node-cron';
import { supabase } from '../db/client';
import { botManager } from '../bots/BotManager';

type SalonNotifySettings = {
  address?: string | null;
  reminders_enabled?: boolean | null;
  review_request_enabled?: boolean | null;
  google_maps_url?: string | null;
};

export function startReminderJobs(): void {
  if (process.env.CRON_ENABLED !== 'true') {
    console.log('Cron reminders disabled');
    return;
  }

  cron.schedule('*/15 * * * *', async () => {
    await sendReminders(24, 'reminder_24h_sent', 'Завтра');
    await sendReminders(2, 'reminder_2h_sent', 'Через 2 години');
    await sendReviewRequests();
  });

  console.log('Reminder cron started (every 15 min)');
}

async function sendReminders(
  hoursAhead: number,
  flagField: 'reminder_24h_sent' | 'reminder_2h_sent',
  timeLabel: string
): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + (hoursAhead * 60 - 15) * 60 * 1000);
  const windowEnd = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  const { data: bookings } = await supabase
    .from('bookings')
    .select(
      'id, salon_id, client_telegram_id, booking_datetime, services(name_uk), masters(name), salons(address, reminders_enabled)'
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

    const dt = new Date(b.booking_datetime);
    const service = Array.isArray(b.services) ? b.services[0] : b.services;
    const master = Array.isArray(b.masters) ? b.masters[0] : b.masters;
    const serviceName = (service as { name_uk: string } | null | undefined)?.name_uk ?? '';
    const masterName = (master as { name: string } | null | undefined)?.name ?? '';
    const address = salon?.address ?? '';

    try {
      await bot.api.sendMessage(
        b.client_telegram_id,
        `⏰ Нагадування!\n${timeLabel} о ${dt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} у вас запис:\n✂️ ${serviceName}\n👤 Майстер: ${masterName}\n📍 ${address}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Скасувати запис', callback_data: `cancel_${b.id}` }]],
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
      'id, salon_id, client_telegram_id, booking_datetime, duration_minutes, visit_status, status, salons(review_request_enabled, google_maps_url, name_uk)'
    )
    .in('status', ['confirmed', 'pending', 'completed'])
    .neq('visit_status', 'refused')
    .eq('review_request_sent', false)
    .gte('booking_datetime', lookbackStart.toISOString())
    .lte('booking_datetime', now.toISOString());

  for (const b of bookings ?? []) {
    if (!b.client_telegram_id) continue;

    const salon = (Array.isArray(b.salons) ? b.salons[0] : b.salons) as
      | (SalonNotifySettings & { name_uk?: string })
      | null;

    if (!salon?.review_request_enabled) continue;
    const mapsUrl = salon.google_maps_url?.trim();
    if (!mapsUrl || !/^https?:\/\//i.test(mapsUrl)) continue;

    const start = new Date(b.booking_datetime).getTime();
    const end = start + Number(b.duration_minutes || 60) * 60_000;
    const hoursAfterEnd = (now.getTime() - end) / 3_600_000;
    // Send once the visit should be finished, within ~1–4 hours after end.
    if (hoursAfterEnd < 1 || hoursAfterEnd > 4) continue;

    const bot = botManager.getBotBySalonId(b.salon_id);
    if (!bot) continue;

    const salonName = salon.name_uk ?? 'нас';

    try {
      await bot.api.sendMessage(
        b.client_telegram_id,
        `Дякуємо, що були в «${salonName}»! 💛\nЯкщо все сподобалось — залиште короткий відгук на Google Maps. Це дуже допомагає.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '⭐ Залишити відгук', url: mapsUrl }]],
          },
        }
      );

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
