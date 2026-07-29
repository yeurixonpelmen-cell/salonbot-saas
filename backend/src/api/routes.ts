import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { supabase } from '../db/client';
import { authMiddleware } from '../middleware/auth';
import { optionalTelegramInitDataMiddleware } from '../middleware/telegramInitData';
import { validateTelegramLoginWidget, isBookingConflictError } from '../utils/telegram';
import {
  signJwt,
  signOnboardingJwt,
  signSalonSelectionJwt,
  verifyOnboardingJwt,
  verifySalonSelectionJwt,
} from '../utils/jwt';
import { encryptBotToken } from '../utils/salon';
import {
  hasBookingConflict,
  hasRoomBookingConflict,
  normalizePhone,
  clientInitials,
} from '../utils/crm';
import {
  generateSlots,
  findAvailableMaster,
  isSlotAvailable,
} from '../utils/slots';
import { sendBookingNotifications } from '../bots/notifications';
import { botManager } from '../bots/BotManager';
import { normalizeBio, normalizePortfolio } from '../utils/portfolio';
import {
  DEFAULT_SALON_TIMEZONE,
  dayRangeUtc,
  normalizeBookingDatetime,
  resolveSalonTimezone,
  zonedDateKey,
} from '../utils/datetime';
import { hashPassword, normalizeEmail, verifyPassword } from '../utils/password';
import { publishSalonBookingsChanged, subscribeSalon } from '../realtime/salonEvents';
import superRoutes from './superRoutes';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const clientFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const CLIENT_FILE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
]);

async function loadSalonTimezone(salonId: string): Promise<string> {
  const { data } = await supabase
    .from('salons')
    .select('timezone')
    .eq('id', salonId)
    .maybeSingle();
  return resolveSalonTimezone(data?.timezone ?? DEFAULT_SALON_TIMEZONE);
}

const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];
const VISIT_STATUSES = [
  'scheduled',
  'first_visit',
  'waiting',
  'in_progress',
  'refused',
  'completed',
];

function safeStorageName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned || 'file';
}

async function resolveClient(
  salonId: string,
  input: {
    clientId?: string;
    clientName?: string;
    clientPhone?: string | null;
    telegramId?: number | null;
  }
) {
  if (input.clientId) {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('id', input.clientId)
      .eq('salon_id', salonId)
      .maybeSingle();
    return data;
  }

  const phone = normalizePhone(input.clientPhone);
  let client = null;
  if (input.telegramId && input.telegramId > 0) {
    const result = await supabase
      .from('clients')
      .select('*')
      .eq('salon_id', salonId)
      .eq('telegram_id', input.telegramId)
      .maybeSingle();
    client = result.data;
  }
  if (!client && phone) {
    const result = await supabase
      .from('clients')
      .select('*')
      .eq('salon_id', salonId)
      .eq('phone', phone)
      .maybeSingle();
    client = result.data;
  }

  if (client) {
    const updates: Record<string, unknown> = {};
    if (input.clientName?.trim()) updates.full_name = input.clientName.trim();
    if (phone) updates.phone = phone;
    if (!client.telegram_id && input.telegramId && input.telegramId > 0) {
      updates.telegram_id = input.telegramId;
    }
    if (Object.keys(updates).length) {
      const result = await supabase
        .from('clients')
        .update(updates)
        .eq('id', client.id)
        .eq('salon_id', salonId)
        .select()
        .single();
      if (result.data) client = result.data;
    }
    return client;
  }

  if (!input.clientName?.trim()) return null;
  const result = await supabase
    .from('clients')
    .insert({
      salon_id: salonId,
      telegram_id: input.telegramId && input.telegramId > 0 ? input.telegramId : null,
      full_name: input.clientName.trim(),
      phone,
    })
    .select()
    .single();
  if (result.data) return result.data;

  // A concurrent request may have inserted the same phone/Telegram client.
  if (input.telegramId && input.telegramId > 0) {
    const retry = await supabase
      .from('clients')
      .select('*')
      .eq('salon_id', salonId)
      .eq('telegram_id', input.telegramId)
      .maybeSingle();
    if (retry.data) return retry.data;
  }
  if (phone) {
    const retry = await supabase
      .from('clients')
      .select('*')
      .eq('salon_id', salonId)
      .eq('phone', phone)
      .maybeSingle();
    if (retry.data) return retry.data;
  }
  return null;
}

function withConflictFlags(
  bookings: any[],
  conflictCandidates: any[] = bookings,
  filesByClient: Map<string, number> = new Map()
) {
  return bookings.map((booking) => {
    const hasConflict =
      hasBookingConflict(booking, conflictCandidates) ||
      hasRoomBookingConflict(booking, conflictCandidates);
    const client = Array.isArray(booking.clients) ? booking.clients[0] : booking.clients;
    const master = Array.isArray(booking.masters) ? booking.masters[0] : booking.masters;
    const service = Array.isArray(booking.services) ? booking.services[0] : booking.services;
    const room = Array.isArray(booking.rooms) ? booking.rooms[0] : booking.rooms;
    return {
      ...booking,
      datetime: booking.booking_datetime,
      client_name: client?.full_name ?? booking.client_name,
      client_phone: client?.phone ?? booking.client_phone,
      client,
      master_name: master?.name,
      service_name: service?.name_uk,
      service_price: service?.price,
      room_id: booking.room_id ?? null,
      room_name: room?.name ?? null,
      has_conflict: hasConflict,
      files_count: booking.client_id ? filesByClient.get(booking.client_id) ?? 0 : 0,
    };
  });
}

async function resolveRoomId(
  salonId: string,
  roomId: unknown,
  options: { requireActive?: boolean } = {}
): Promise<{ id: string } | null | undefined> {
  if (roomId === undefined) return undefined;
  if (roomId === null || roomId === '') return null;
  if (typeof roomId !== 'string') return null;
  let query = supabase
    .from('rooms')
    .select('id')
    .eq('id', roomId)
    .eq('salon_id', salonId);
  if (options.requireActive !== false) {
    query = query.eq('is_active', true);
  }
  const { data } = await query.maybeSingle();
  return data ?? null;
}

async function assertRoomAvailable(params: {
  salonId: string;
  roomId: string | null;
  bookingDatetime: string;
  durationMinutes: number;
  excludeBookingId?: string;
}): Promise<string | null> {
  const { salonId, roomId, bookingDatetime, durationMinutes, excludeBookingId } = params;
  if (!roomId) return null;

  const start = new Date(bookingDatetime);
  if (Number.isNaN(start.getTime())) return 'Invalid datetime';
  const windowStart = new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('bookings')
    .select('id, master_id, room_id, booking_datetime, duration_minutes, status')
    .eq('salon_id', salonId)
    .eq('room_id', roomId)
    .neq('status', 'cancelled')
    .gte('booking_datetime', windowStart)
    .lte('booking_datetime', windowEnd);

  if (excludeBookingId) query = query.neq('id', excludeBookingId);

  const { data } = await query;
  const probe = {
    id: excludeBookingId ?? 'new',
    master_id: '',
    room_id: roomId,
    booking_datetime: bookingDatetime,
    duration_minutes: durationMinutes,
    status: 'confirmed',
  };
  if (hasRoomBookingConflict(probe, data ?? [])) {
    return 'Цей кабінет уже зайнятий у цей час';
  }
  return null;
}

const bookingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
});

const onboardingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many onboarding requests' },
});

// ─── Public ───────────────────────────────────────────────

router.get('/salons/:salonId', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('salons')
    .select('name_uk, name_en, logo_url, address')
    .eq('id', req.params.salonId)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Salon not found' });
    return;
  }
  res.json(data);
});

router.get('/salons/:salonId/services', async (req: Request, res: Response) => {
  const { data } = await supabase
    .from('services')
    .select('id, name_uk, name_en, duration_minutes, price')
    .eq('salon_id', req.params.salonId)
    .eq('is_active', true);

  res.json(data ?? []);
});

router.get('/salons/:salonId/masters', async (req: Request, res: Response) => {
  const serviceId = req.query.serviceId as string;
  if (!serviceId) {
    res.status(400).json({ error: 'serviceId required' });
    return;
  }

  const { data: service } = await supabase
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('salon_id', req.params.salonId)
    .eq('is_active', true)
    .maybeSingle();

  if (!service) {
    res.json([]);
    return;
  }

  const { data: links } = await supabase
    .from('master_services')
    .select('master_id')
    .eq('service_id', serviceId);

  const masterIds = (links ?? []).map((l) => l.master_id);
  if (!masterIds.length) {
    res.json([]);
    return;
  }

  const { data } = await supabase
    .from('masters')
    .select('id, name, photo_url, position, bio, portfolio')
    .in('id', masterIds)
    .eq('salon_id', req.params.salonId)
    .eq('is_active', true);

  res.json(
    (data ?? []).map((master) => ({
      ...master,
      bio: master.bio ?? null,
      portfolio: normalizePortfolio(master.portfolio),
    }))
  );
});

router.get('/salons/:salonId/slots', async (req: Request, res: Response) => {
  const masterId = (req.query.masterId as string) || null;
  const serviceId = req.query.serviceId as string;
  if (!serviceId) {
    res.status(400).json({ error: 'serviceId required' });
    return;
  }

  const slots = await generateSlots(req.params.salonId, masterId, serviceId);
  res.json(slots);
});

router.post(
  '/bookings',
  bookingLimiter,
  optionalTelegramInitDataMiddleware,
  async (req: Request, res: Response) => {
  let { salonId, masterId, serviceId, clientName, clientPhone, datetime } = req.body;
  const clientTelegramId = req.telegramUser?.id ?? null;
  const phone = normalizePhone(clientPhone);

  if (!salonId || !serviceId || !clientName || !datetime) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  if (!clientTelegramId && !phone) {
    res.status(400).json({ error: 'Вкажіть телефон для запису' });
    return;
  }

  let normalizedDatetime: string;
  try {
    const timeZone = await loadSalonTimezone(salonId);
    normalizedDatetime = normalizeBookingDatetime(datetime, timeZone);
  } catch {
    res.status(400).json({ error: 'Invalid datetime' });
    return;
  }

  if (!masterId) {
    masterId = await findAvailableMaster(salonId, serviceId, normalizedDatetime);
    if (!masterId) {
      res.status(409).json({ error: 'Цей час вже зайнятий. Оберіть інший.' });
      return;
    }
  } else if (!(await isSlotAvailable(salonId, masterId, serviceId, normalizedDatetime))) {
    res.status(409).json({ error: 'Цей час вже зайнятий. Оберіть інший.' });
    return;
  }

  const [{ data: service }, { data: salonSettings }, { data: masterRow }] = await Promise.all([
    supabase
      .from('services')
      .select('duration_minutes, name_uk')
      .eq('id', serviceId)
      .eq('salon_id', salonId)
      .single(),
    supabase
      .from('salons')
      .select('address, require_booking_confirmation')
      .eq('id', salonId)
      .single(),
    supabase
      .from('masters')
      .select('name, default_room_id')
      .eq('id', masterId)
      .eq('salon_id', salonId)
      .maybeSingle(),
  ]);

  if (!service) {
    res.status(400).json({ error: 'Service not found' });
    return;
  }
  if (!masterRow) {
    res.status(400).json({ error: 'Master not found' });
    return;
  }

  const requiresConfirmation = Boolean(salonSettings?.require_booking_confirmation);
  const bookingStatus = requiresConfirmation ? 'pending' : 'confirmed';
  const defaultRoom = masterRow.default_room_id
    ? await resolveRoomId(salonId, masterRow.default_room_id)
    : null;
  const nextRoomId = defaultRoom?.id ?? null;
  const roomBusy = await assertRoomAvailable({
    salonId,
    roomId: nextRoomId,
    bookingDatetime: normalizedDatetime,
    durationMinutes: service.duration_minutes,
  });
  if (roomBusy) {
    res.status(409).json({ error: roomBusy });
    return;
  }

  const client = await resolveClient(salonId, {
    clientName,
    clientPhone: phone,
    telegramId: clientTelegramId,
  });

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      salon_id: salonId,
      master_id: masterId,
      service_id: serviceId,
      client_telegram_id: clientTelegramId,
      client_name: clientName,
      client_phone: phone,
      client_id: client?.id ?? null,
      booking_datetime: normalizedDatetime,
      duration_minutes: service.duration_minutes,
      status: bookingStatus,
      room_id: nextRoomId,
    })
    .select('id')
    .single();

  if (error) {
    if (isBookingConflictError(error)) {
      res.status(409).json({ error: 'Цей час вже зайнятий. Оберіть інший.' });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }

  const master = masterRow;

  await sendBookingNotifications(
    salonId,
    booking.id,
    clientTelegramId,
    clientName,
    phone,
    normalizedDatetime,
    service.name_uk,
    master.name ?? '',
    salonSettings?.address ?? '',
    { requiresConfirmation }
  );

  publishSalonBookingsChanged(salonId);

  res.json({
    booking_id: booking.id,
    confirmationMessage: requiresConfirmation
      ? 'Запис створено, очікує підтвердження'
      : 'Запис підтверджено',
    status: bookingStatus,
  });
});

// ─── Auth ─────────────────────────────────────────────────

router.post('/auth/telegram', async (req: Request, res: Response) => {
  const botToken = process.env.ADMIN_LOGIN_BOT_TOKEN;
  if (!botToken) {
    res.status(500).json({ error: 'Login bot not configured' });
    return;
  }

  const data = req.body as Record<string, string>;
  if (!validateTelegramLoginWidget(data, botToken)) {
    res.status(401).json({ error: 'Invalid login data' });
    return;
  }

  const ownerTelegramId = Number(data.id);
  const { data: salons } = await supabase
    .from('salons')
    .select('id, name_uk')
    .eq('owner_telegram_id', ownerTelegramId)
    .eq('is_active', true);

  if (!salons?.length) {
    // Setup is email+code only; do not open Telegram onboarding.
    res.json({
      needsEmailOnboarding: true,
      error: 'Немає салону для цього Telegram. Підключення лише за кодом активації через email.',
    });
    return;
  }

  if (salons.length === 1) {
    const token = signJwt({
      salon_id: salons[0].id,
      owner_telegram_id: ownerTelegramId,
      role: 'telegram_owner',
    });
    res.json({ token, salon: salons[0], salons });
    return;
  }

  res.json({
    salons,
    selectionToken: signSalonSelectionJwt(ownerTelegramId),
    needsSalonPick: true,
  });
});

router.post('/auth/email', async (req: Request, res: Response) => {
  const email = normalizeEmail(String(req.body?.email ?? ''));
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    res.status(400).json({ error: 'Email і пароль обов’язкові' });
    return;
  }

  const { data: staff, error } = await supabase
    .from('salon_staff')
    .select('id, salon_id, email, password_hash, is_active, role')
    .eq('email', email)
    .maybeSingle();

  if (error || !staff || !staff.is_active) {
    res.status(401).json({ error: 'Невірний email або пароль' });
    return;
  }

  if (!verifyPassword(password, staff.password_hash)) {
    res.status(401).json({ error: 'Невірний email або пароль' });
    return;
  }

  const { data: salon } = await supabase
    .from('salons')
    .select('id, name_uk, is_active')
    .eq('id', staff.salon_id)
    .maybeSingle();

  if (!salon?.is_active) {
    res.status(401).json({ error: 'Салон вимкнено' });
    return;
  }

  const token = signJwt({
    salon_id: staff.salon_id,
    staff_id: staff.id,
    email: staff.email,
    role: 'staff',
  });

  res.json({
    token,
    salon: { id: salon.id, name_uk: salon.name_uk },
  });
});

router.post('/auth/select-salon', async (req: Request, res: Response) => {
  const { salonId, selectionToken } = req.body;
  if (!salonId || typeof selectionToken !== 'string') {
    res.status(400).json({ error: 'salonId and selectionToken required' });
    return;
  }

  const selection = verifySalonSelectionJwt(selectionToken);
  if (!selection) {
    res.status(401).json({ error: 'Invalid selection token' });
    return;
  }

  const { data: salon } = await supabase
    .from('salons')
    .select('id, name_uk')
    .eq('id', salonId)
    .eq('owner_telegram_id', selection.owner_telegram_id)
    .single();

  if (!salon) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const token = signJwt({
    salon_id: salon.id,
    owner_telegram_id: selection.owner_telegram_id,
    role: 'telegram_owner',
  });
  res.json({ token, salon });
});

// ─── Onboarding (email + activation code only, 1 salon) ───

function normalizeActivationCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

router.post('/onboarding/claim', onboardingLimiter, async (req: Request, res: Response) => {
  const email = normalizeEmail(String(req.body?.email ?? ''));
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const code = normalizeActivationCode(req.body?.code);

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Вкажіть коректний email' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Пароль має бути щонайменше 8 символів' });
    return;
  }
  if (!code) {
    res.status(400).json({ error: 'Вкажіть код активації' });
    return;
  }

  const { data: existingStaff } = await supabase
    .from('salon_staff')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existingStaff) {
    res.status(409).json({ error: 'Цей email уже прив’язаний до салону. Увійдіть через /login' });
    return;
  }

  const { data: codeRow, error: codeError } = await supabase
    .from('activation_codes')
    .select('id, code, status, reserved_email, invite_email, password_hash')
    .ilike('code', code)
    .maybeSingle();

  if (codeError || !codeRow) {
    res.status(404).json({ error: 'Код активації не знайдено' });
    return;
  }
  if (codeRow.status === 'redeemed' || codeRow.status === 'revoked') {
    res.status(410).json({ error: 'Цей код уже використано або скасовано' });
    return;
  }

  const inviteEmail = normalizeEmail(codeRow.invite_email ?? '');
  if (inviteEmail && inviteEmail !== email) {
    res.status(403).json({
      error: `Цей код надіслано на інший email. Увійдіть з адресою, на яку прийшов лист`,
    });
    return;
  }

  if (codeRow.status === 'reserved') {
    if (normalizeEmail(codeRow.reserved_email ?? '') !== email) {
      res.status(409).json({ error: 'Код уже зарезервовано іншим email' });
      return;
    }
    if (!codeRow.password_hash || !verifyPassword(password, codeRow.password_hash)) {
      res.status(401).json({ error: 'Невірний пароль для цього коду' });
      return;
    }
    const onboardingToken = signOnboardingJwt(codeRow.id, email);
    res.json({ onboardingToken, email, code: codeRow.code });
    return;
  }

  const password_hash = hashPassword(password);
  const { data: reserved, error: reserveError } = await supabase
    .from('activation_codes')
    .update({
      status: 'reserved',
      reserved_email: email,
      password_hash,
      reserved_at: new Date().toISOString(),
    })
    .eq('id', codeRow.id)
    .eq('status', 'unused')
    .select('id, code')
    .maybeSingle();

  if (reserveError || !reserved) {
    res.status(409).json({ error: 'Не вдалось зарезервувати код. Спробуйте ще раз' });
    return;
  }

  const onboardingToken = signOnboardingJwt(reserved.id, email);
  res.json({ onboardingToken, email, code: reserved.code });
});

router.post('/onboarding/password', onboardingLimiter, async (req: Request, res: Response) => {
  const onboardingToken = String(req.body?.onboardingToken ?? '');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (password.length < 8) {
    res.status(400).json({ error: 'Пароль має бути щонайменше 8 символів' });
    return;
  }

  const session = verifyOnboardingJwt(onboardingToken);
  if (!session) {
    res.status(401).json({ error: 'Сесія онбордингу закінчилась. Почніть знову з коду та email' });
    return;
  }

  const { data: codeRow, error } = await supabase
    .from('activation_codes')
    .select('id, status, reserved_email')
    .eq('id', session.code_id)
    .maybeSingle();

  if (error || !codeRow) {
    res.status(404).json({ error: 'Код активації не знайдено' });
    return;
  }
  if (codeRow.status !== 'reserved' || normalizeEmail(codeRow.reserved_email ?? '') !== session.email) {
    res.status(403).json({ error: 'Код не зарезервовано на цей email' });
    return;
  }

  const { error: updateError } = await supabase
    .from('activation_codes')
    .update({ password_hash: hashPassword(password) })
    .eq('id', codeRow.id)
    .eq('status', 'reserved');

  if (updateError) {
    res.status(500).json({ error: updateError.message });
    return;
  }

  res.json({ ok: true });
});

router.post('/onboarding/verify-bot', onboardingLimiter, async (req: Request, res: Response) => {
  const { token } = req.body;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = (await resp.json()) as { ok: boolean; result?: { username: string } };
    if (json.ok && json.result) {
      res.json({ ok: true, username: json.result.username });
    } else {
      res.json({ ok: false, error: 'Invalid token' });
    }
  } catch {
    res.status(500).json({ ok: false, error: 'Verification failed' });
  }
});

router.post('/onboarding/verify-chat', onboardingLimiter, async (req: Request, res: Response) => {
  const { botToken, chatId } = req.body;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ Сповіщення налаштовано! Тут з'являтимуться нові записи.",
      }),
    });
    const json = (await resp.json()) as { ok: boolean };
    res.json({ ok: json.ok });
  } catch {
    res.status(500).json({ ok: false });
  }
});

router.post('/onboarding/logo', onboardingLimiter, upload.single('logo'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file' });
    return;
  }

  if (!req.file.mimetype.startsWith('image/')) {
    res.status(400).json({ error: 'Only image uploads are allowed' });
    return;
  }

  const ext = req.file.originalname.split('.').pop() ?? 'png';
  const path = `pending/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from('logos').upload(path, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: true,
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path);
  res.json({ url: urlData.publicUrl });
});

router.post('/onboarding/complete', onboardingLimiter, async (req: Request, res: Response) => {
  const {
    onboardingToken,
    nameUk,
    nameEn,
    address,
    logoUrl,
    rawBotToken,
    botUsername,
    adminChatId,
  } = req.body;

  if (!onboardingToken || !nameUk || !rawBotToken || !botUsername) {
    res.status(400).json({ error: 'Missing required onboarding fields' });
    return;
  }

  const session = verifyOnboardingJwt(String(onboardingToken));
  if (!session) {
    res.status(401).json({ error: 'Сесія онбордингу закінчилась. Почніть знову з коду та email' });
    return;
  }

  const { data: codeRow, error: codeError } = await supabase
    .from('activation_codes')
    .select('id, status, reserved_email, password_hash')
    .eq('id', session.code_id)
    .maybeSingle();

  if (codeError || !codeRow) {
    res.status(404).json({ error: 'Код активації не знайдено' });
    return;
  }
  if (codeRow.status === 'redeemed' || codeRow.status === 'revoked') {
    res.status(410).json({ error: 'Цей код уже використано або скасовано' });
    return;
  }
  if (codeRow.status !== 'reserved' || normalizeEmail(codeRow.reserved_email ?? '') !== session.email) {
    res.status(403).json({ error: 'Код не зарезервовано на цей email' });
    return;
  }
  if (!codeRow.password_hash) {
    res.status(400).json({ error: 'Сесія онбордингу пошкоджена. Почніть знову' });
    return;
  }

  const { data: existingStaff } = await supabase
    .from('salon_staff')
    .select('id')
    .eq('email', session.email)
    .maybeSingle();
  if (existingStaff) {
    res.status(409).json({ error: 'Цей email уже прив’язаний до салону' });
    return;
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${rawBotToken}/getMe`);
    const json = (await resp.json()) as { ok: boolean; result?: { username: string } };
    if (!json.ok || json.result?.username !== botUsername) {
      res.status(400).json({ error: 'Bot token verification failed' });
      return;
    }
  } catch {
    res.status(500).json({ error: 'Bot verification failed' });
    return;
  }

  const encryptedToken = await encryptBotToken(rawBotToken);
  if (!encryptedToken) {
    res.status(500).json({ error: 'Failed to encrypt token' });
    return;
  }

  const { data: salon, error } = await supabase
    .from('salons')
    .insert({
      name_uk: nameUk,
      name_en: nameEn ?? null,
      address: address ?? null,
      logo_url: logoUrl ?? null,
      bot_token: encryptedToken,
      bot_username: botUsername,
      admin_chat_id: adminChatId ?? null,
      owner_telegram_id: 0,
    })
    .select('id, name_uk')
    .single();

  if (error || !salon) {
    res.status(500).json({ error: error?.message ?? 'Failed to create salon' });
    return;
  }

  const { data: staff, error: staffError } = await supabase
    .from('salon_staff')
    .insert({
      salon_id: salon.id,
      email: session.email,
      password_hash: codeRow.password_hash,
      full_name: null,
      role: 'owner',
      is_active: true,
    })
    .select('id, email')
    .single();

  if (staffError || !staff) {
    await supabase.from('salons').delete().eq('id', salon.id);
    res.status(500).json({ error: staffError?.message ?? 'Failed to create owner account' });
    return;
  }

  const { error: redeemError } = await supabase
    .from('activation_codes')
    .update({
      status: 'redeemed',
      redeemed_at: new Date().toISOString(),
      salon_id: salon.id,
      password_hash: null,
    })
    .eq('id', codeRow.id)
    .eq('status', 'reserved');

  if (redeemError) {
    console.error('Failed to redeem activation code', redeemError);
  }

  if (logoUrl) {
    try {
      const imgResp = await fetch(logoUrl);
      const blob = await imgResp.blob();
      const formData = new FormData();
      formData.append('photo', blob);
      await fetch(`https://api.telegram.org/bot${rawBotToken}/setMyPhoto`, {
        method: 'POST',
        body: formData,
      });
    } catch {
      // non-critical
    }
  }

  await botManager.addBot(rawBotToken, salon.id);

  const token = signJwt({
    salon_id: salon.id,
    staff_id: staff.id,
    email: staff.email,
    role: 'staff',
  });
  res.json({ salonId: salon.id, token, botUsername, email: staff.email });
});

// ─── Admin (protected) ────────────────────────────────────

router.use('/admin', adminLimiter, authMiddleware);

const SALON_SETTINGS_SELECT =
  'id, name_uk, name_en, address, logo_url, bot_username, admin_chat_id, timezone, language, reminders_enabled, review_request_enabled, require_booking_confirmation, google_maps_url, is_active';

router.get('/admin/salon', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('salons')
    .select(SALON_SETTINGS_SELECT)
    .eq('id', req.auth!.salon_id!)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data || data.is_active === false) {
    res.status(401).json({ error: 'Салон видалено або вимкнено. Увійдіть знову.' });
    return;
  }

  res.json(data);
});

router.patch('/admin/salon', async (req: Request, res: Response) => {
  const {
    name_uk,
    name_en,
    address,
    logo_url,
    admin_chat_id,
    language,
    reminders_enabled,
    review_request_enabled,
    require_booking_confirmation,
    google_maps_url,
  } = req.body;

  const update: Record<string, unknown> = {
    name_uk,
    name_en,
    address,
    logo_url,
    admin_chat_id,
  };
  if (typeof language === 'string') {
    const normalized = language.trim().toLowerCase();
    if (!['uk', 'ru', 'en'].includes(normalized)) {
      res.status(400).json({ error: 'Мова має бути uk, ru або en' });
      return;
    }
    update.language = normalized;
  }
  if (typeof reminders_enabled === 'boolean') update.reminders_enabled = reminders_enabled;
  if (typeof review_request_enabled === 'boolean') {
    update.review_request_enabled = review_request_enabled;
  }
  if (typeof require_booking_confirmation === 'boolean') {
    update.require_booking_confirmation = require_booking_confirmation;
  }
  if (google_maps_url !== undefined) {
    const raw = typeof google_maps_url === 'string' ? google_maps_url.trim() : '';
    if (raw && !/^https?:\/\//i.test(raw)) {
      res.status(400).json({ error: 'Посилання Google Maps має починатись з https://' });
      return;
    }
    update.google_maps_url = raw || null;
  }

  const { data, error } = await supabase
    .from('salons')
    .update(update)
    .eq('id', req.auth!.salon_id!)
    .select(SALON_SETTINGS_SELECT)
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

router.post('/admin/salon/logo', upload.single('logo'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file' });
    return;
  }

  const ext = req.file.originalname.split('.').pop() ?? 'png';
  const path = `${req.auth!.salon_id!}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from('logos').upload(path, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: true,
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path);
  res.json({ url: urlData.publicUrl });
});

router.post('/admin/masters/photo', upload.single('photo'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file' });
    return;
  }
  if (!req.file.mimetype.startsWith('image/')) {
    res.status(400).json({ error: 'Можна лише зображення (фото)' });
    return;
  }

  const ext = req.file.originalname.split('.').pop() ?? 'jpg';
  const path = `${req.auth!.salon_id!}/masters/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from('logos').upload(path, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: true,
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path);
  res.json({ url: urlData.publicUrl });
});

function parseClientsQueryFlag(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return null;
}

function normalizeClientSearchText(value: string): string {
  return value
    .toLocaleLowerCase('uk')
    .replace(/[^a-zа-яёіїєґ0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clientSearchBlob(client: {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  general_notes?: string | null;
  tags?: string[] | null;
}): string {
  return normalizeClientSearchText(
    [client.full_name, client.phone, client.email, client.general_notes, ...(client.tags ?? [])]
      .filter(Boolean)
      .join(' ')
  );
}

function clientMatchesSearch(
  client: {
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
    general_notes?: string | null;
    tags?: string[] | null;
  },
  search: string
): boolean {
  const q = search.trim();
  if (!q) return true;
  const blob = clientSearchBlob(client);
  const compactBlob = blob.replace(/\s+/g, '');
  const tokens = normalizeClientSearchText(q).split(' ').filter(Boolean);
  const textOk = !tokens.length || tokens.every((token) => blob.includes(token) || compactBlob.includes(token.replace(/\s+/g, '')));
  const digits = q.replace(/\D+/g, '');
  const phoneDigits = (client.phone ?? '').replace(/\D+/g, '');
  const phoneOk = digits.length >= 3 && phoneDigits.includes(digits);
  return textOk || phoneOk;
}

router.get('/admin/clients', async (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string'
    ? req.query.search.trim().replace(/[,%()]/g, '')
    : '';
  const segmentRaw = typeof req.query.segment === 'string' ? req.query.segment.trim().toLowerCase() : 'all';
  const segment = segmentRaw === 'new' || segmentRaw === 'old' ? segmentRaw : 'all';
  const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
  const visits = typeof req.query.visits === 'string' ? req.query.visits.trim().toLowerCase() : 'all';
  const hasPhone = parseClientsQueryFlag(req.query.has_phone);
  const hasEmail = parseClientsQueryFlag(req.query.has_email);
  const hasTelegram = parseClientsQueryFlag(req.query.has_telegram);
  const hasNotes = parseClientsQueryFlag(req.query.has_notes);
  const hasDob = parseClientsQueryFlag(req.query.has_dob);
  const legacy = req.query.legacy === '1' || req.query.legacy === 'true';

  const now = new Date();
  let periodTo = typeof req.query.created_to === 'string' && req.query.created_to.trim()
    ? new Date(req.query.created_to)
    : now;
  let periodFrom = typeof req.query.created_from === 'string' && req.query.created_from.trim()
    ? new Date(req.query.created_from)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(periodFrom.getTime())) periodFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(periodTo.getTime())) periodTo = now;
  if (periodFrom > periodTo) {
    const swap = periodFrom;
    periodFrom = periodTo;
    periodTo = swap;
  }
  // Inclusive end-of-day for date-only values
  if (typeof req.query.created_to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.created_to.trim())) {
    periodTo = new Date(`${req.query.created_to.trim()}T23:59:59.999`);
  }
  if (typeof req.query.created_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.created_from.trim())) {
    periodFrom = new Date(`${req.query.created_from.trim()}T00:00:00.000`);
  }

  let query = supabase
    .from('clients')
    .select('*')
    .eq('salon_id', req.auth!.salon_id!)
    .order('updated_at', { ascending: false })
    .limit(2000);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  let clients = data ?? [];
  const availableTags = Array.from(
    new Set(clients.flatMap((client) => (Array.isArray(client.tags) ? client.tags : [])))
  ).sort((a, b) => a.localeCompare(b, 'uk'));

  if (tag) {
    const tagNorm = tag.toLocaleLowerCase('uk');
    clients = clients.filter((client) =>
      (client.tags ?? []).some((item: string) => String(item).toLocaleLowerCase('uk') === tagNorm)
    );
  }

  const hasText = (value: unknown) => Boolean(typeof value === 'string' ? value.trim() : value);

  if (hasPhone === true) clients = clients.filter((c) => hasText(c.phone));
  if (hasPhone === false) clients = clients.filter((c) => !hasText(c.phone));
  if (hasEmail === true) clients = clients.filter((c) => hasText(c.email));
  if (hasEmail === false) clients = clients.filter((c) => !hasText(c.email));
  if (hasTelegram === true) clients = clients.filter((c) => c.telegram_id != null);
  if (hasTelegram === false) clients = clients.filter((c) => c.telegram_id == null);
  if (hasNotes === true) clients = clients.filter((c) => hasText(c.general_notes));
  if (hasNotes === false) clients = clients.filter((c) => !hasText(c.general_notes));
  if (hasDob === true) clients = clients.filter((c) => Boolean(c.date_of_birth));
  if (hasDob === false) clients = clients.filter((c) => !c.date_of_birth);

  if (search) {
    clients = clients.filter((client) => clientMatchesSearch(client, search));
  }

  const clientIds = clients.map((client) => client.id);
  const stats = new Map<string, { count: number; last: string | null }>();
  if (clientIds.length) {
    const { data: visitsRows } = await supabase
      .from('bookings')
      .select('client_id, booking_datetime, status')
      .eq('salon_id', req.auth!.salon_id!)
      .in('client_id', clientIds)
      .neq('status', 'cancelled')
      .order('booking_datetime', { ascending: false });
    for (const visit of visitsRows ?? []) {
      if (!visit.client_id) continue;
      const current = stats.get(visit.client_id) ?? { count: 0, last: null };
      current.count += 1;
      current.last ??= visit.booking_datetime;
      stats.set(visit.client_id, current);
    }
  }

  let enriched = clients.map((client) => {
    const createdAt = client.created_at ? new Date(client.created_at) : null;
    const isNewInPeriod = Boolean(
      createdAt && createdAt >= periodFrom && createdAt <= periodTo
    );
    return {
      ...client,
      initials: clientInitials(client.full_name),
      visits_count: stats.get(client.id)?.count ?? 0,
      last_visit_at: stats.get(client.id)?.last ?? null,
      is_new_in_period: isNewInPeriod,
    };
  });

  const newInPeriod = enriched.filter((client) => client.is_new_in_period).length;
  const oldInPeriod = enriched.length - newInPeriod;

  if (segment === 'new') {
    enriched = enriched.filter((client) => client.is_new_in_period);
  } else if (segment === 'old') {
    enriched = enriched.filter((client) => !client.is_new_in_period);
  }

  if (visits === 'none') {
    enriched = enriched.filter((client) => (client.visits_count ?? 0) === 0);
  } else if (visits === 'some') {
    enriched = enriched.filter((client) => (client.visits_count ?? 0) >= 1);
  } else if (visits === 'many') {
    enriched = enriched.filter((client) => (client.visits_count ?? 0) >= 5);
  }

  const summary = {
    total: enriched.length,
    new_in_period: newInPeriod,
    old_in_period: oldInPeriod,
    period_from: periodFrom.toISOString(),
    period_to: periodTo.toISOString(),
  };

  if (legacy) {
    res.json(enriched);
    return;
  }

  res.json({ clients: enriched, summary, available_tags: availableTags });
});

router.post('/admin/clients', async (req: Request, res: Response) => {
  const {
    full_name,
    fullName,
    phone,
    email,
    date_of_birth,
    dateOfBirth,
    general_notes,
    generalNotes,
    tags,
    telegram_id,
  } = req.body;
  const name = (full_name ?? fullName)?.trim();
  const normalizedPhone = normalizePhone(phone);
  if (!name && !normalizedPhone) {
    res.status(400).json({ error: 'Вкажіть ім’я або телефон' });
    return;
  }
  const { data, error } = await supabase
    .from('clients')
    .insert({
      salon_id: req.auth!.salon_id!,
      telegram_id: telegram_id ?? null,
      full_name: name || normalizedPhone,
      phone: normalizedPhone,
      email: email?.trim() || null,
      date_of_birth: date_of_birth ?? dateOfBirth ?? null,
      general_notes: general_notes ?? generalNotes ?? null,
      tags: Array.isArray(tags) ? tags : [],
    })
    .select()
    .single();
  if (error) {
    res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.get('/admin/clients/:id', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', req.params.id)
    .eq('salon_id', salonId)
    .maybeSingle();
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  const [{ data: bookings }, { data: files }] = await Promise.all([
    supabase
      .from('bookings')
      .select('*, masters(name), services(name_uk, price), booking_notes(*)')
      .eq('salon_id', salonId)
      .eq('client_id', client.id)
      .order('booking_datetime', { ascending: false }),
    supabase
      .from('client_files')
      .select('id, client_id, booking_id, file_name, mime_type, size_bytes, created_at')
      .eq('salon_id', salonId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: false }),
  ]);
  res.json({
    ...client,
    initials: clientInitials(client.full_name),
    visits_count: (bookings ?? []).filter((b) => b.status !== 'cancelled').length,
    bookings: withConflictFlags(bookings ?? []),
    files: files ?? [],
  });
});

router.patch('/admin/clients/:id', async (req: Request, res: Response) => {
  const allowed = [
    'full_name',
    'phone',
    'email',
    'date_of_birth',
    'general_notes',
    'tags',
    'telegram_id',
  ];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }
  if (req.body.fullName !== undefined) update.full_name = req.body.fullName;
  if (req.body.dateOfBirth !== undefined) update.date_of_birth = req.body.dateOfBirth;
  if (req.body.generalNotes !== undefined) update.general_notes = req.body.generalNotes;
  if (update.phone !== undefined) update.phone = normalizePhone(update.phone);
  if (update.telegram_id !== undefined) {
    const raw = update.telegram_id;
    if (raw === '' || raw === null) update.telegram_id = null;
    else {
      const parsed = Number(raw);
      update.telegram_id = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  }
  if (!Object.keys(update).length) {
    res.status(400).json({ error: 'No supported fields to update' });
    return;
  }
  const { data, error } = await supabase
    .from('clients')
    .update(update)
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id!)
    .select()
    .maybeSingle();
  if (error) {
    res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json({ ...data, initials: clientInitials(data.full_name) });
});

router.delete('/admin/clients/:id', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const clientId = req.params.id;
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('salon_id', salonId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  const { data: files } = await supabase
    .from('client_files')
    .select('id, storage_path')
    .eq('salon_id', salonId)
    .eq('client_id', clientId);

  for (const file of files ?? []) {
    if (file.storage_path) {
      await supabase.storage.from('client-files').remove([file.storage_path]);
    }
  }
  if ((files ?? []).length) {
    await supabase
      .from('client_files')
      .delete()
      .eq('salon_id', salonId)
      .eq('client_id', clientId);
  }

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', clientId)
    .eq('salon_id', salonId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

router.post(
  '/admin/clients/:id/files',
  clientFileUpload.single('file'),
  async (req: Request, res: Response) => {
    const salonId = req.auth!.salon_id!;
    if (!req.file) {
      res.status(400).json({ error: 'No file' });
      return;
    }
    if (!CLIENT_FILE_MIME_TYPES.has(req.file.mimetype)) {
      res.status(400).json({ error: 'Unsupported file type' });
      return;
    }
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', req.params.id)
      .eq('salon_id', salonId)
      .maybeSingle();
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    let bookingId: string | null = req.body.bookingId ?? null;
    if (bookingId) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('id, client_id')
        .eq('id', bookingId)
        .eq('salon_id', salonId)
        .maybeSingle();
      if (!booking || (booking.client_id && booking.client_id !== client.id)) {
        res.status(400).json({ error: 'Booking does not belong to this client' });
        return;
      }
    }
    const path = `${salonId}/${client.id}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}-${safeStorageName(req.file.originalname)}`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (uploadError) {
      res.status(500).json({ error: uploadError.message });
      return;
    }
    const { data, error } = await supabase
      .from('client_files')
      .insert({
        salon_id: salonId,
        client_id: client.id,
        booking_id: bookingId,
        storage_path: path,
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
      })
      .select()
      .single();
    if (error) {
      await supabase.storage.from('client-files').remove([path]);
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json(data);
  }
);

router.get('/admin/clients/:id/files', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', req.params.id)
    .eq('salon_id', salonId)
    .maybeSingle();
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  const { data, error } = await supabase
    .from('client_files')
    .select('*')
    .eq('salon_id', salonId)
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const files = await Promise.all(
    (data ?? []).map(async (file) => {
      const { data: signed } = await supabase.storage
        .from('client-files')
        .createSignedUrl(file.storage_path, 3600);
      return { ...file, signed_url: signed?.signedUrl ?? null };
    })
  );
  res.json(files);
});

router.delete('/admin/clients/:clientId/files/:fileId', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { data: file } = await supabase
    .from('client_files')
    .select('*')
    .eq('id', req.params.fileId)
    .eq('client_id', req.params.clientId)
    .eq('salon_id', salonId)
    .maybeSingle();
  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  const { error: storageError } = await supabase.storage
    .from('client-files')
    .remove([file.storage_path]);
  if (storageError) {
    res.status(500).json({ error: storageError.message });
    return;
  }
  const { error } = await supabase
    .from('client_files')
    .delete()
    .eq('id', file.id)
    .eq('salon_id', salonId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

router.get('/admin/bookings', async (req: Request, res: Response) => {
  const date = req.query.date as string;
  const masterId = req.query.masterId as string | undefined;
  const status = req.query.status as string | undefined;
  const salonId = req.auth!.salon_id!;
  const timeZone = await loadSalonTimezone(salonId);
  let query = supabase
    .from('bookings')
    .select(
      '*, masters(name), services(name_uk, price, duration_minutes), clients(*), booking_notes(*), rooms(name)'
    )
    .eq('salon_id', salonId);
  let dayStartIso: string | null = null;
  let dayEndIso: string | null = null;
  if (date) {
    try {
      const range = dayRangeUtc(date, timeZone);
      dayStartIso = range.startIso;
      dayEndIso = range.endIso;
      query = query.gte('booking_datetime', dayStartIso).lte('booking_datetime', dayEndIso);
    } catch {
      res.status(400).json({ error: 'Invalid date' });
      return;
    }
  }
  if (masterId) query = query.eq('master_id', masterId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('booking_datetime');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const bookings = data ?? [];
  if (!bookings.length) {
    res.json([]);
    return;
  }
  const masterIds = [...new Set(bookings.map((booking) => booking.master_id))];
  let conflictQuery = supabase
    .from('bookings')
    .select('id, master_id, room_id, booking_datetime, duration_minutes, status')
    .eq('salon_id', salonId)
    .in('master_id', masterIds)
    .neq('status', 'cancelled');
  if (dayStartIso && dayEndIso) {
    const prevStart = new Date(dayStartIso);
    prevStart.setUTCDate(prevStart.getUTCDate() - 1);
    conflictQuery = conflictQuery
      .gte('booking_datetime', prevStart.toISOString())
      .lte('booking_datetime', dayEndIso);
  }
  const clientIds = [...new Set(bookings.map((booking) => booking.client_id).filter(Boolean))];
  const [{ data: conflictCandidates }, { data: clientFiles }] = await Promise.all([
    conflictQuery,
    clientIds.length
      ? supabase
        .from('client_files')
        .select('client_id')
        .eq('salon_id', req.auth!.salon_id!)
        .in('client_id', clientIds)
      : Promise.resolve({ data: [] as { client_id: string | null }[] }),
  ]);
  const filesByClient = new Map<string, number>();
  for (const file of clientFiles ?? []) {
    if (!file.client_id) continue;
    filesByClient.set(file.client_id, (filesByClient.get(file.client_id) ?? 0) + 1);
  }
  res.json(withConflictFlags(bookings, conflictCandidates ?? bookings, filesByClient));
});

router.get('/admin/bookings/stream', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as Response & { flushHeaders: () => void }).flushHeaders();
  }

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const unsubscribe = subscribeSalon(salonId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const ping = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

router.post('/admin/bookings', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { masterId, serviceId, clientId, clientName, clientPhone, datetime, notes, roomId } = req.body;
  if (!masterId || !serviceId || !datetime || (!clientId && !clientName)) {
    res.status(400).json({ error: 'masterId, serviceId, datetime and client are required' });
    return;
  }
  let normalizedDatetime: string;
  try {
    const timeZone = await loadSalonTimezone(salonId);
    normalizedDatetime = normalizeBookingDatetime(datetime, timeZone);
  } catch {
    res.status(400).json({ error: 'Invalid datetime' });
    return;
  }
  const [{ data: master }, { data: service }] = await Promise.all([
    supabase
      .from('masters')
      .select('id, default_room_id')
      .eq('id', masterId)
      .eq('salon_id', salonId)
      .maybeSingle(),
    supabase
      .from('services')
      .select('id, duration_minutes')
      .eq('id', serviceId)
      .eq('salon_id', salonId)
      .maybeSingle(),
  ]);
  if (!master || !service) {
    res.status(400).json({ error: 'Master or service not found' });
    return;
  }
  let nextRoomId: string | null = null;
  if (roomId === undefined) {
    nextRoomId = master.default_room_id
      ? (await resolveRoomId(salonId, master.default_room_id))?.id ?? null
      : null;
  } else {
    const room = await resolveRoomId(salonId, roomId);
    if (roomId !== null && roomId !== '' && room === null) {
      res.status(400).json({ error: 'Room not found' });
      return;
    }
    nextRoomId = room?.id ?? null;
  }
  const roomBusy = await assertRoomAvailable({
    salonId,
    roomId: nextRoomId,
    bookingDatetime: normalizedDatetime,
    durationMinutes: service.duration_minutes,
  });
  if (roomBusy) {
    res.status(409).json({ error: roomBusy });
    return;
  }
  const client = await resolveClient(salonId, { clientId, clientName, clientPhone });
  if (!client) {
    res.status(400).json({ error: 'Client not found or could not be created' });
    return;
  }
  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('salon_id', salonId)
    .eq('client_id', client.id)
    .neq('status', 'cancelled');
  const { data, error } = await supabase
    .from('bookings')
    .insert({
      salon_id: salonId,
      master_id: master.id,
      service_id: service.id,
      client_id: client.id,
      client_telegram_id: client.telegram_id ?? -Date.now(),
      client_name: client.full_name,
      client_phone: client.phone,
      booking_datetime: normalizedDatetime,
      duration_minutes: service.duration_minutes,
      status: 'confirmed',
      visit_status: count === 0 ? 'first_visit' : 'scheduled',
      notes: notes ?? null,
      room_id: nextRoomId,
    })
    .select('*, masters(name), services(name_uk, price), clients(*), booking_notes(*), rooms(name)')
    .single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create booking' });
    return;
  }
  await supabase.from('booking_notes').insert({
    salon_id: salonId,
    booking_id: data.id,
    author_id: req.auth!.owner_telegram_id ?? null,
    body: typeof notes === 'string' && notes.trim() ? notes.trim() : 'Booking created',
  });
  publishSalonBookingsChanged(salonId);
  res.status(201).json(withConflictFlags([data])[0]);
});

router.get('/admin/bookings/:id/notes', async (req: Request, res: Response) => {
  const { data: booking } = await supabase
    .from('bookings')
    .select('id')
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id!)
    .maybeSingle();
  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }
  const { data, error } = await supabase
    .from('booking_notes')
    .select('*')
    .eq('booking_id', booking.id)
    .eq('salon_id', req.auth!.salon_id!)
    .order('created_at');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

router.post('/admin/bookings/:id/notes', async (req: Request, res: Response) => {
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) {
    res.status(400).json({ error: 'body is required' });
    return;
  }
  const salonId = req.auth!.salon_id!;
  const { data: booking } = await supabase
    .from('bookings')
    .select('id')
    .eq('id', req.params.id)
    .eq('salon_id', salonId)
    .maybeSingle();
  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }
  const { data, error } = await supabase
    .from('booking_notes')
    .insert({
      salon_id: salonId,
      booking_id: booking.id,
      author_id: req.auth!.owner_telegram_id ?? null,
      body,
    })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.patch('/admin/bookings/:id', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { data: existing } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', req.params.id)
    .eq('salon_id', salonId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }
  const {
    status,
    notes,
    visit_status,
    visitStatus,
    needs_attention,
    needsAttention,
    attention_reason,
    attentionReason,
    masterId,
    serviceId,
    datetime,
    clientId,
    roomId,
  } = req.body;
  const nextVisitStatus = visit_status ?? visitStatus;
  if (status !== undefined && !BOOKING_STATUSES.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  if (nextVisitStatus !== undefined && !VISIT_STATUSES.includes(nextVisitStatus)) {
    res.status(400).json({ error: 'Invalid visit_status' });
    return;
  }
  const nextMasterId = masterId ?? existing.master_id;
  const nextServiceId = serviceId ?? existing.service_id;
  const [{ data: master }, { data: service }] = await Promise.all([
    supabase
      .from('masters')
      .select('id')
      .eq('id', nextMasterId)
      .eq('salon_id', salonId)
      .maybeSingle(),
    supabase
      .from('services')
      .select('id, duration_minutes')
      .eq('id', nextServiceId)
      .eq('salon_id', salonId)
      .maybeSingle(),
  ]);
  if (!master || !service) {
    res.status(400).json({ error: 'Master or service not found' });
    return;
  }
  let nextRoomId: string | null = existing.room_id ?? null;
  if (roomId !== undefined) {
    const room = await resolveRoomId(salonId, roomId);
    if (roomId !== null && roomId !== '' && room === null) {
      res.status(400).json({ error: 'Room not found' });
      return;
    }
    nextRoomId = room?.id ?? null;
  }
  let client = null;
  if (clientId !== undefined) {
    client = await resolveClient(salonId, { clientId });
    if (!client) {
      res.status(400).json({ error: 'Client not found' });
      return;
    }
  }
  const update: Record<string, unknown> = {
    master_id: master.id,
    service_id: service.id,
    duration_minutes: service.duration_minutes,
    room_id: nextRoomId,
  };
  if (status !== undefined) update.status = status;
  if (notes !== undefined) update.notes = notes;
  if (nextVisitStatus !== undefined) update.visit_status = nextVisitStatus;
  if (needs_attention !== undefined || needsAttention !== undefined) {
    update.needs_attention = needs_attention ?? needsAttention;
  }
  if (attention_reason !== undefined || attentionReason !== undefined) {
    update.attention_reason = attention_reason ?? attentionReason;
  }
  if (datetime !== undefined) {
    try {
      const timeZone = await loadSalonTimezone(salonId);
      update.booking_datetime = normalizeBookingDatetime(datetime, timeZone);
    } catch {
      res.status(400).json({ error: 'Invalid datetime' });
      return;
    }
  }
  if (client) {
    update.client_id = client.id;
    update.client_name = client.full_name;
    update.client_phone = client.phone;
    update.client_telegram_id = client.telegram_id ?? -Date.now();
  }
  const bookingDatetime = String(update.booking_datetime ?? existing.booking_datetime);
  const roomBusy = await assertRoomAvailable({
    salonId,
    roomId: nextRoomId,
    bookingDatetime,
    durationMinutes: service.duration_minutes,
    excludeBookingId: existing.id,
  });
  if (roomBusy) {
    res.status(409).json({ error: roomBusy });
    return;
  }
  const { data, error } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', existing.id)
    .eq('salon_id', salonId)
    .select(
      '*, masters(name), services(name_uk, price, duration_minutes), clients(*), booking_notes(*), rooms(name)'
    )
    .single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to update booking' });
    return;
  }
  if (notes !== undefined && notes !== existing.notes) {
    await supabase.from('booking_notes').insert({
      salon_id: salonId,
      booking_id: existing.id,
      author_id: req.auth!.owner_telegram_id ?? null,
      body: typeof notes === 'string' && notes.trim() ? notes.trim() : 'Notes cleared',
    });
  }
  publishSalonBookingsChanged(salonId);
  res.json(withConflictFlags([data])[0]);
});

router.delete('/admin/bookings/:id', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { data: existing } = await supabase
    .from('bookings')
    .select('id')
    .eq('id', req.params.id)
    .eq('salon_id', salonId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  const { error } = await supabase
    .from('bookings')
    .delete()
    .eq('id', existing.id)
    .eq('salon_id', salonId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  publishSalonBookingsChanged(salonId);
  res.json({ ok: true });
});

// Rooms CRUD
router.get('/admin/rooms', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, salon_id, name, sort_order, is_active, created_at')
    .eq('salon_id', req.auth!.salon_id!)
    .order('sort_order')
    .order('name');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

router.post('/admin/rooms', async (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0;
  const { data, error } = await supabase
    .from('rooms')
    .insert({
      salon_id: req.auth!.salon_id!,
      name,
      sort_order: sortOrder,
      is_active: req.body?.is_active !== false,
    })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

router.patch('/admin/rooms/:id', async (req: Request, res: Response) => {
  const update: Record<string, unknown> = {};
  if (typeof req.body?.name === 'string') {
    const name = req.body.name.trim();
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    update.name = name;
  }
  if (req.body?.sort_order !== undefined) {
    update.sort_order = Number(req.body.sort_order) || 0;
  }
  if (req.body?.is_active !== undefined) update.is_active = Boolean(req.body.is_active);
  if (!Object.keys(update).length) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }
  const { data, error } = await supabase
    .from('rooms')
    .update(update)
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id!)
    .select()
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(data);
});

router.delete('/admin/rooms/:id', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { data, error } = await supabase
    .from('rooms')
    .update({ is_active: false })
    .eq('id', req.params.id)
    .eq('salon_id', salonId)
    .select()
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(data);
});

// Masters CRUD
router.get('/admin/masters', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const [{ data }, { data: rooms }] = await Promise.all([
    supabase
      .from('masters')
      .select('id, salon_id, name, photo_url, position, bio, portfolio, is_active, default_room_id')
      .eq('salon_id', salonId)
      .order('name'),
    supabase.from('rooms').select('id, name').eq('salon_id', salonId),
  ]);
  const roomNameById = new Map((rooms ?? []).map((room) => [room.id, room.name]));
  res.json(
    (data ?? []).map((master) => ({
      ...master,
      bio: master.bio ?? null,
      default_room_id: master.default_room_id ?? null,
      default_room_name: master.default_room_id
        ? roomNameById.get(master.default_room_id) ?? null
        : null,
      portfolio: normalizePortfolio(master.portfolio),
    }))
  );
});

router.post('/admin/masters', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { name, photo_url, position, is_active, bio, portfolio, default_room_id } = req.body;
  let nextDefaultRoomId: string | null = null;
  if (default_room_id !== undefined && default_room_id !== null && default_room_id !== '') {
    const room = await resolveRoomId(salonId, default_room_id, { requireActive: false });
    if (!room) {
      res.status(400).json({ error: 'Кабінет не знайдено' });
      return;
    }
    nextDefaultRoomId = room.id;
  }
  const { data, error } = await supabase
    .from('masters')
    .insert({
      salon_id: salonId,
      name,
      photo_url,
      position,
      is_active,
      bio: normalizeBio(bio),
      portfolio: normalizePortfolio(portfolio),
      default_room_id: nextDefaultRoomId,
    })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({
    ...data,
    bio: data.bio ?? null,
    default_room_id: data.default_room_id ?? null,
    portfolio: normalizePortfolio(data.portfolio),
  });
});

router.patch('/admin/masters/:id', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id!;
  const { name, photo_url, position, is_active, bio, portfolio, default_room_id } = req.body;
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (photo_url !== undefined) patch.photo_url = photo_url;
  if (position !== undefined) patch.position = position;
  if (is_active !== undefined) patch.is_active = is_active;
  if (bio !== undefined) patch.bio = normalizeBio(bio);
  if (portfolio !== undefined) patch.portfolio = normalizePortfolio(portfolio);
  if (default_room_id !== undefined) {
    if (default_room_id === null || default_room_id === '') {
      patch.default_room_id = null;
    } else {
      const room = await resolveRoomId(salonId, default_room_id, { requireActive: false });
      if (!room) {
        res.status(400).json({ error: 'Кабінет не знайдено' });
        return;
      }
      patch.default_room_id = room.id;
    }
  }

  const { data, error } = await supabase
    .from('masters')
    .update(patch)
    .eq('id', req.params.id)
    .eq('salon_id', salonId)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Attach default cabinet to existing bookings that have no room yet.
  if (typeof patch.default_room_id === 'string' && patch.default_room_id) {
    await supabase
      .from('bookings')
      .update({ room_id: patch.default_room_id })
      .eq('salon_id', salonId)
      .eq('master_id', req.params.id)
      .is('room_id', null)
      .neq('status', 'cancelled')
      .gte('booking_datetime', new Date().toISOString());
    publishSalonBookingsChanged(salonId);
  }

  res.json({
    ...data,
    bio: data.bio ?? null,
    default_room_id: data.default_room_id ?? null,
    portfolio: normalizePortfolio(data.portfolio),
  });
});

router.delete('/admin/masters/:id', async (req: Request, res: Response) => {
  await supabase
    .from('masters')
    .delete()
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id!);
  res.json({ ok: true });
});

router.get('/admin/masters/:id/schedule', async (req: Request, res: Response) => {
  const { data: master } = await supabase
    .from('masters')
    .select('id')
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id!)
    .single();

  if (!master) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { data } = await supabase
    .from('schedules')
    .select('id, master_id, day_of_week, start_time, end_time')
    .eq('master_id', req.params.id);
  res.json(data ?? []);
});

router.put('/admin/masters/:id/schedule', async (req: Request, res: Response) => {
  const masterId = req.params.id;
  const schedules = req.body as { day_of_week: number; start_time: string; end_time: string }[];

  const { data: master } = await supabase
    .from('masters')
    .select('id')
    .eq('id', masterId)
    .eq('salon_id', req.auth!.salon_id!)
    .single();

  if (!master) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  await supabase.from('schedules').delete().eq('master_id', masterId);

  if (schedules.length) {
    const rows = schedules.map((s) => ({
      master_id: masterId,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    }));
    await supabase.from('schedules').insert(rows);
  }

  res.json({ ok: true });
});

// Services CRUD
router.get('/admin/services', async (req: Request, res: Response) => {
  const { data: services } = await supabase
    .from('services')
    .select('id, salon_id, name_uk, name_en, duration_minutes, price, is_active')
    .eq('salon_id', req.auth!.salon_id!)
    .order('name_uk');

  const result = [];
  for (const s of services ?? []) {
    const { data: links } = await supabase
      .from('master_services')
      .select('master_id, masters(name)')
      .eq('service_id', s.id);
    result.push({
      ...s,
      masters: (links ?? []).map((l) => {
        const master = Array.isArray(l.masters) ? l.masters[0] : l.masters;
        return {
          id: l.master_id,
          name: (master as { name: string } | null | undefined)?.name,
        };
      }),
    });
  }
  res.json(result);
});

router.post('/admin/services', async (req: Request, res: Response) => {
  const { name_uk, name_en, duration_minutes, price, is_active, masterIds } = req.body;
  const { data, error } = await supabase
    .from('services')
    .insert({
      salon_id: req.auth!.salon_id!,
      name_uk,
      name_en,
      duration_minutes,
      price,
      is_active,
    })
    .select()
    .single();

  if (error || !data) {
    res.status(500).json({ error: error?.message });
    return;
  }

  if (masterIds?.length) {
    const { data: ownedMasters } = await supabase
      .from('masters')
      .select('id')
      .eq('salon_id', req.auth!.salon_id!)
      .in('id', masterIds);
    const ownedMasterIds = (ownedMasters ?? []).map((m) => m.id);
    if (ownedMasterIds.length) {
      await supabase
        .from('master_services')
        .insert(ownedMasterIds.map((mid: string) => ({ master_id: mid, service_id: data.id })));
    }
  }

  res.json(data);
});

router.patch('/admin/services/:id', async (req: Request, res: Response) => {
  const { masterIds, name_uk, name_en, duration_minutes, price, is_active } = req.body;
  const { data, error } = await supabase
    .from('services')
    .update({ name_uk, name_en, duration_minutes, price, is_active })
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id!)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  if (masterIds) {
    await supabase.from('master_services').delete().eq('service_id', req.params.id);
    if (masterIds.length) {
      const { data: ownedMasters } = await supabase
        .from('masters')
        .select('id')
        .eq('salon_id', req.auth!.salon_id!)
        .in('id', masterIds);
      const ownedMasterIds = (ownedMasters ?? []).map((m) => m.id);
      if (ownedMasterIds.length) {
        await supabase
          .from('master_services')
          .insert(ownedMasterIds.map((mid: string) => ({ master_id: mid, service_id: req.params.id })));
      }
    }
  }

  res.json(data);
});

router.delete('/admin/services/:id', async (req: Request, res: Response) => {
  await supabase
    .from('services')
    .delete()
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id!);
  res.json({ ok: true });
});

router.use('/super', superRoutes);

export default router;
