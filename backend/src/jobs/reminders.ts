import cron from 'node-cron';
import { supabase } from '../db/client';
import { botManager } from '../bots/BotManager';

export function startReminderJobs(): void {
  if (process.env.CRON_ENABLED !== 'true') {
    console.log('Cron reminders disabled');
    return;
  }

  cron.schedule('*/15 * * * *', async () => {
    await sendReminders(24, 'reminder_24h_sent', 'Завтра');
    await sendReminders(2, 'reminder_2h_sent', 'Через 2 години');
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
      'id, salon_id, client_telegram_id, booking_datetime, services(name_uk), masters(name), salons(address)'
    )
    .in('status', ['confirmed', 'pending'])
    .eq(flagField, false)
    .gte('booking_datetime', windowStart.toISOString())
    .lte('booking_datetime', windowEnd.toISOString());

  for (const b of bookings ?? []) {
    if (!b.client_telegram_id) continue;

    const bot = botManager.getBotBySalonId(b.salon_id);
    if (!bot) continue;

    const dt = new Date(b.booking_datetime);
    const service = Array.isArray(b.services) ? b.services[0] : b.services;
    const master = Array.isArray(b.masters) ? b.masters[0] : b.masters;
    const salon = Array.isArray(b.salons) ? b.salons[0] : b.salons;
    const serviceName = (service as { name_uk: string } | null | undefined)?.name_uk ?? '';
    const masterName = (master as { name: string } | null | undefined)?.name ?? '';
    const address = (salon as { address: string } | null | undefined)?.address ?? '';

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
