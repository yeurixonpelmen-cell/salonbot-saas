export const translations = {
  uk: {
    chooseService: 'Оберіть послугу',
    chooseMaster: 'Оберіть майстра',
    anyMaster: '🎲 Будь-який вільний майстер',
    chooseTime: 'Оберіть час',
    yourBooking: 'Ваш запис',
    name: "Ваше ім'я",
    phone: 'Телефон',
    book: 'ЗАПИСАТИСЬ',
    success: 'Ви записані!',
    reminder: 'Нагадування прийде в цей бот за 24 год і за 2 год',
    myBookings: 'Мої записи',
    home: 'Головна',
    back: 'Назад',
    min: 'хв',
    slotTaken: 'Цей час вже зайнятий. Оберіть інший.',
    loading: 'Завантаження...',
    noServices: 'Поки немає доступних послуг.',
    noMasters: 'Поки немає доступних майстрів для цієї послуги.',
    noSlots: 'Немає вільних слотів на найближчі 14 днів.',
    retry: 'Спробувати ще раз',
    requiredFields: "Заповніть ім'я і телефон.",
    openInTelegram: 'Відкрийте цю сторінку через Telegram-бота.',
  },
  en: {
    chooseService: 'Choose a service',
    chooseMaster: 'Choose a master',
    anyMaster: '🎲 Any available master',
    chooseTime: 'Choose time',
    yourBooking: 'Your booking',
    name: 'Your name',
    phone: 'Phone',
    book: 'BOOK NOW',
    success: 'You are booked!',
    reminder: 'Reminder will be sent 24h and 2h before',
    myBookings: 'My bookings',
    home: 'Home',
    back: 'Back',
    min: 'min',
    slotTaken: 'This time slot is taken. Choose another.',
    loading: 'Loading...',
    noServices: 'No available services yet.',
    noMasters: 'No available masters for this service yet.',
    noSlots: 'No free slots for the next 14 days.',
    retry: 'Try again',
    requiredFields: 'Fill in your name and phone.',
    openInTelegram: 'Open this page from the Telegram bot.',
  },
} as const;

export type Lang = keyof typeof translations;

export function getLang(): Lang {
  const code = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  return code === 'uk' ? 'uk' : 'en';
}

export function t(key: keyof typeof translations.uk): string {
  const lang = getLang();
  return translations[lang][key];
}
