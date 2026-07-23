export const translations = {
  uk: {
    bookOnline: 'Онлайн-запис',
    chooseService: 'Оберіть послугу',
    chooseMaster: 'Оберіть спеціаліста',
    anyMaster: 'Будь-який вільний',
    anyMasterHint: 'Підберемо хто вільний',
    chooseTime: 'Дата і час',
    yourBooking: 'Підтвердження',
    name: "Ім'я",
    phone: 'Телефон',
    book: 'Записатись',
    success: 'Ви записані!',
    successHint: 'Ми отримали ваш запис. Салон зв’яжеться за потреби.',
    successHintTelegram: 'Деталі також у чаті з ботом',
    reminder: 'Якщо є Telegram — нагадаємо за 24 год і за 2 год до візиту',
    myBookings: 'Закрити',
    home: 'Новий запис',
    back: 'Назад',
    min: 'хв',
    uah: '₴',
    address: 'Адреса',
    slotTaken: 'Цей час уже зайнятий. Оберіть інший.',
    loading: 'Завантаження…',
    noServices: 'Поки немає доступних послуг.',
    noMasters: 'Немає спеціалістів для цієї послуги.',
    noSlots: 'Немає вільних слотів на найближчі 14 днів.',
    requiredFields: "Вкажіть ім'я і телефон.",
    invalidPhone: 'Вкажіть коректний номер телефону',
    openInTelegram: 'Відкрийте запис через Telegram-бота.',
    missingSalon: 'Немає ID салону. Відкрийте посилання з Instagram, Viber або бота.',
    webBookingNote: 'Запис через сайт — Telegram не обов’язковий',
    stepService: 'Послуга',
    stepMaster: 'Майстер',
    stepTime: 'Час',
    stepConfirm: 'Готово',
    duration: 'Тривалість',
    price: 'Ціна',
    when: 'Коли',
    specialist: 'Спеціаліст',
    service: 'Послуга',
  },
  en: {
    bookOnline: 'Online booking',
    chooseService: 'Choose a service',
    chooseMaster: 'Choose a specialist',
    anyMaster: 'Any available',
    anyMasterHint: 'We’ll pick who’s free',
    chooseTime: 'Date & time',
    yourBooking: 'Confirm booking',
    name: 'Name',
    phone: 'Phone',
    book: 'Book now',
    success: 'You’re booked!',
    successHint: 'We got your booking. The salon may contact you if needed.',
    successHintTelegram: 'Details are also in the bot chat',
    reminder: 'If you use Telegram — we’ll remind you 24h and 2h before',
    myBookings: 'Close',
    home: 'New booking',
    back: 'Back',
    min: 'min',
    uah: '₴',
    address: 'Address',
    slotTaken: 'This slot is taken. Pick another.',
    loading: 'Loading…',
    noServices: 'No services available yet.',
    noMasters: 'No specialists for this service.',
    noSlots: 'No free slots for the next 14 days.',
    requiredFields: 'Enter your name and phone.',
    invalidPhone: 'Enter a valid phone number',
    openInTelegram: 'Open booking from the Telegram bot.',
    missingSalon: 'Salon ID missing. Open the link from Instagram, Viber, or the bot.',
    webBookingNote: 'Web booking — Telegram is optional',
    stepService: 'Service',
    stepMaster: 'Master',
    stepTime: 'Time',
    stepConfirm: 'Done',
    duration: 'Duration',
    price: 'Price',
    when: 'When',
    specialist: 'Specialist',
    service: 'Service',
  },
} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof typeof translations.uk;

const STORAGE_KEY = 'salonbot_lang';

export function detectLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'uk' || saved === 'en') return saved;
  const code = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  return code === 'uk' || code === 'ru' ? 'uk' : 'en';
}

export function persistLang(lang: Lang): void {
  localStorage.setItem(STORAGE_KEY, lang);
}

export function translate(lang: Lang, key: TranslationKey): string {
  return translations[lang][key];
}
