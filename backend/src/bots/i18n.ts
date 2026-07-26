import { supabase } from '../db/client';

export type BotLang = 'uk' | 'ru' | 'en';

const LANGS: BotLang[] = ['uk', 'ru', 'en'];

export function normalizeBotLang(value: unknown): BotLang {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  if (raw === 'ua') return 'uk';
  return LANGS.includes(raw as BotLang) ? (raw as BotLang) : 'uk';
}

export function localeForLang(lang: BotLang): string {
  if (lang === 'ru') return 'ru-RU';
  if (lang === 'en') return 'en-GB';
  return 'uk-UA';
}

type Dictionary = {
  welcome: string;
  openBooking: string;
  startFailed: string;
  noBookings: string;
  status: string;
  bookingAccepted: string;
  awaitingConfirm: string;
  cancelBooking: string;
  master: string;
  reminderTitle: string;
  reminderTomorrow: string;
  reminderIn2h: string;
  reminderBody: (time: string) => string;
  reviewThanks: (salonName: string) => string;
  leaveReview: string;
  languageSaved: string;
  chooseLanguage: string;
  langUk: string;
  langRu: string;
  langEn: string;
  bookingCancelled: string;
  bookingConfirmed: string;
  bookingCancelledAdmin: string;
  insufficientRights: string;
  bookingNotFound: string;
  statusLabels: Record<string, string>;
};

const dictionaries: Record<BotLang, Dictionary> = {
  uk: {
    welcome:
      'Вітаємо! 👋\nНатисніть кнопку нижче — оберіть послугу, майстра і час онлайн.',
    openBooking: '📅 Записатися',
    startFailed: 'Не вдалось відкрити запис онлайн. Спробуйте пізніше.',
    noBookings: 'У вас немає активних записів.',
    status: 'Статус',
    bookingAccepted: '✅ Запис прийнято!',
    awaitingConfirm: 'Очікує підтвердження салону.',
    cancelBooking: '❌ Скасувати запис',
    master: 'Майстер',
    reminderTitle: '⏰ Нагадування!',
    reminderTomorrow: 'Завтра',
    reminderIn2h: 'Через 2 години',
    reminderBody: (time) => `у вас запис о ${time}:`,
    reviewThanks: (salonName) =>
      `Дякуємо, що були в «${salonName}»! 💛\nЯкщо все сподобалось — залиште короткий відгук на Google Maps. Це дуже допомагає.`,
    leaveReview: '⭐ Залишити відгук',
    languageSaved: 'Мову змінено.',
    chooseLanguage: 'Мова / Language',
    langUk: '🇺🇦 Українська',
    langRu: '🇷🇺 Русский',
    langEn: '🇬🇧 English',
    bookingCancelled: '❌ Запис скасовано.',
    bookingConfirmed: '✅ Запис підтверджено.',
    bookingCancelledAdmin: '❌ Запис скасовано адміністратором.',
    insufficientRights: 'Недостатньо прав',
    bookingNotFound: 'Запис не знайдено',
    statusLabels: {
      pending: 'очікує',
      confirmed: 'підтверджено',
      cancelled: 'скасовано',
      completed: 'завершено',
    },
  },
  ru: {
    welcome:
      'Добро пожаловать! 👋\nНажмите кнопку ниже — выберите услугу, мастера и время онлайн.',
    openBooking: '📅 Записаться',
    startFailed: 'Не удалось открыть онлайн-запись. Попробуйте позже.',
    noBookings: 'У вас нет активных записей.',
    status: 'Статус',
    bookingAccepted: '✅ Запись принята!',
    awaitingConfirm: 'Ожидает подтверждения салона.',
    cancelBooking: '❌ Отменить запись',
    master: 'Мастер',
    reminderTitle: '⏰ Напоминание!',
    reminderTomorrow: 'Завтра',
    reminderIn2h: 'Через 2 часа',
    reminderBody: (time) => `у вас запись в ${time}:`,
    reviewThanks: (salonName) =>
      `Спасибо, что были в «${salonName}»! 💛\nЕсли всё понравилось — оставьте короткий отзыв в Google Maps. Это очень помогает.`,
    leaveReview: '⭐ Оставить отзыв',
    languageSaved: 'Язык изменён.',
    chooseLanguage: 'Язык / Language',
    langUk: '🇺🇦 Українська',
    langRu: '🇷🇺 Русский',
    langEn: '🇬🇧 English',
    bookingCancelled: '❌ Запись отменена.',
    bookingConfirmed: '✅ Запись подтверждена.',
    bookingCancelledAdmin: '❌ Запись отменена администратором.',
    insufficientRights: 'Недостаточно прав',
    bookingNotFound: 'Запись не найдена',
    statusLabels: {
      pending: 'ожидает',
      confirmed: 'подтверждена',
      cancelled: 'отменена',
      completed: 'завершена',
    },
  },
  en: {
    welcome:
      'Welcome! 👋\nTap the button below to pick a service, specialist and time.',
    openBooking: '📅 Book now',
    startFailed: 'Could not open online booking. Please try again later.',
    noBookings: 'You have no upcoming bookings.',
    status: 'Status',
    bookingAccepted: '✅ Booking received!',
    awaitingConfirm: 'Waiting for salon confirmation.',
    cancelBooking: '❌ Cancel booking',
    master: 'Specialist',
    reminderTitle: '⏰ Reminder!',
    reminderTomorrow: 'Tomorrow',
    reminderIn2h: 'In 2 hours',
    reminderBody: (time) => `you have an appointment at ${time}:`,
    reviewThanks: (salonName) =>
      `Thanks for visiting «${salonName}»! 💛\nIf you enjoyed it, please leave a short Google Maps review. It really helps.`,
    leaveReview: '⭐ Leave a review',
    languageSaved: 'Language updated.',
    chooseLanguage: 'Language',
    langUk: '🇺🇦 Українська',
    langRu: '🇷🇺 Русский',
    langEn: '🇬🇧 English',
    bookingCancelled: '❌ Booking cancelled.',
    bookingConfirmed: '✅ Booking confirmed.',
    bookingCancelledAdmin: '❌ Booking cancelled by admin.',
    insufficientRights: 'Not allowed',
    bookingNotFound: 'Booking not found',
    statusLabels: {
      pending: 'pending',
      confirmed: 'confirmed',
      cancelled: 'cancelled',
      completed: 'completed',
    },
  },
};

export function t(lang: BotLang): Dictionary {
  return dictionaries[normalizeBotLang(lang)];
}

export async function getSalonLanguage(salonId: string): Promise<BotLang> {
  const { data } = await supabase.from('salons').select('language').eq('id', salonId).maybeSingle();
  return normalizeBotLang(data?.language);
}

export async function getUserBotLanguage(
  salonId: string,
  telegramId: number | null | undefined
): Promise<BotLang> {
  if (telegramId) {
    const { data: pref } = await supabase
      .from('bot_user_prefs')
      .select('language')
      .eq('salon_id', salonId)
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (pref?.language) return normalizeBotLang(pref.language);
  }
  return getSalonLanguage(salonId);
}

export async function setUserBotLanguage(
  salonId: string,
  telegramId: number,
  language: BotLang
): Promise<void> {
  const lang = normalizeBotLang(language);
  await supabase.from('bot_user_prefs').upsert({
    salon_id: salonId,
    telegram_id: telegramId,
    language: lang,
    updated_at: new Date().toISOString(),
  });
}

export function languageKeyboard(lang: BotLang) {
  const d = t(lang);
  return {
    inline_keyboard: [
      [
        { text: d.langUk, callback_data: 'lang_uk' },
        { text: d.langRu, callback_data: 'lang_ru' },
        { text: d.langEn, callback_data: 'lang_en' },
      ],
    ],
  };
}

export function serviceDisplayName(
  lang: BotLang,
  service: { name_uk?: string | null; name_en?: string | null } | null | undefined
): string {
  if (!service) return '';
  if (lang === 'en' && service.name_en?.trim()) return service.name_en.trim();
  return (service.name_uk ?? service.name_en ?? '').trim();
}
