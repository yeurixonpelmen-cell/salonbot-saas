import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { supabase } from '../db/client';
import { authMiddleware } from '../middleware/auth';
import { optionalTelegramInitDataMiddleware } from '../middleware/telegramInitData';
import { validateTelegramLoginWidget, isBookingConflictError } from '../utils/telegram';
import { signJwt, signSalonSelectionJwt, verifySalonSelectionJwt } from '../utils/jwt';
import { encryptBotToken } from '../utils/salon';
import { hasBookingConflict, normalizePhone, clientInitials } from '../utils/crm';
import {
  generateSlots,
  findAvailableMaster,
  isSlotAvailable,
} from '../utils/slots';
import { sendBookingNotifications } from '../bots/notifications';
import { botManager } from '../bots/BotManager';
import { normalizeBio, normalizePortfolio } from '../utils/portfolio';

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
    const hasConflict = hasBookingConflict(booking, conflictCandidates);
    const client = Array.isArray(booking.clients) ? booking.clients[0] : booking.clients;
    const master = Array.isArray(booking.masters) ? booking.masters[0] : booking.masters;
    const service = Array.isArray(booking.services) ? booking.services[0] : booking.services;
    return {
      ...booking,
      datetime: booking.booking_datetime,
      client_name: client?.full_name ?? booking.client_name,
      client_phone: client?.phone ?? booking.client_phone,
      client,
      master_name: master?.name,
      service_name: service?.name_uk,
      service_price: service?.price,
      has_conflict: hasConflict,
      files_count: booking.client_id ? filesByClient.get(booking.client_id) ?? 0 : 0,
    };
  });
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

  if (!masterId) {
    masterId = await findAvailableMaster(salonId, serviceId, datetime);
    if (!masterId) {
      res.status(409).json({ error: 'Цей час вже зайнятий. Оберіть інший.' });
      return;
    }
  } else if (!(await isSlotAvailable(salonId, masterId, serviceId, datetime))) {
    res.status(409).json({ error: 'Цей час вже зайнятий. Оберіть інший.' });
    return;
  }

  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes, name_uk')
    .eq('id', serviceId)
    .eq('salon_id', salonId)
    .single();

  if (!service) {
    res.status(400).json({ error: 'Service not found' });
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
      booking_datetime: datetime,
      duration_minutes: service.duration_minutes,
      status: 'pending',
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

  const { data: master } = await supabase.from('masters').select('name').eq('id', masterId).single();
  const { data: salon } = await supabase.from('salons').select('address').eq('id', salonId).single();

  await sendBookingNotifications(
    salonId,
    booking.id,
    clientTelegramId,
    clientName,
    phone,
    datetime,
    service.name_uk,
    master?.name ?? '',
    salon?.address ?? ''
  );

  res.json({
    booking_id: booking.id,
    confirmationMessage: 'Запис створено',
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
    res.json({ needsOnboarding: true, ownerTelegramId, firstName: data.first_name });
    return;
  }

  if (salons.length === 1) {
    const token = signJwt({ salon_id: salons[0].id, owner_telegram_id: ownerTelegramId });
    res.json({ token, salon: salons[0], salons });
    return;
  }

  res.json({
    salons,
    selectionToken: signSalonSelectionJwt(ownerTelegramId),
    needsSalonPick: true,
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

  const token = signJwt({ salon_id: salon.id, owner_telegram_id: selection.owner_telegram_id });
  res.json({ token, salon });
});

// ─── Onboarding ───────────────────────────────────────────

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
    ownerTelegramId,
    ownerAuthData,
    nameUk,
    nameEn,
    address,
    logoUrl,
    rawBotToken,
    botUsername,
    adminChatId,
  } = req.body;

  if (!ownerTelegramId || !nameUk || !rawBotToken || !botUsername) {
    res.status(400).json({ error: 'Missing required onboarding fields' });
    return;
  }

  const loginBotToken = process.env.ADMIN_LOGIN_BOT_TOKEN;
  if (!loginBotToken || !ownerAuthData || !validateTelegramLoginWidget(ownerAuthData, loginBotToken)) {
    res.status(401).json({ error: 'Invalid owner Telegram login data' });
    return;
  }

  if (Number(ownerAuthData.id) !== Number(ownerTelegramId)) {
    res.status(401).json({ error: 'Owner Telegram ID mismatch' });
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
      owner_telegram_id: ownerTelegramId,
    })
    .select('id')
    .single();

  if (error || !salon) {
    res.status(500).json({ error: error?.message ?? 'Failed to create salon' });
    return;
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

  const token = signJwt({ salon_id: salon.id, owner_telegram_id: ownerTelegramId });
  res.json({ salonId: salon.id, token, botUsername });
});

// ─── Admin (protected) ────────────────────────────────────

router.use('/admin', adminLimiter, authMiddleware);

router.get('/admin/salon', async (req: Request, res: Response) => {
  const { data } = await supabase
    .from('salons')
    .select(
      'id, name_uk, name_en, address, logo_url, bot_username, admin_chat_id, reminders_enabled, review_request_enabled, google_maps_url'
    )
    .eq('id', req.auth!.salon_id)
    .single();

  res.json(data);
});

router.patch('/admin/salon', async (req: Request, res: Response) => {
  const {
    name_uk,
    name_en,
    address,
    logo_url,
    admin_chat_id,
    reminders_enabled,
    review_request_enabled,
    google_maps_url,
  } = req.body;

  const update: Record<string, unknown> = {
    name_uk,
    name_en,
    address,
    logo_url,
    admin_chat_id,
  };
  if (typeof reminders_enabled === 'boolean') update.reminders_enabled = reminders_enabled;
  if (typeof review_request_enabled === 'boolean') {
    update.review_request_enabled = review_request_enabled;
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
    .eq('id', req.auth!.salon_id)
    .select(
      'id, name_uk, name_en, address, logo_url, bot_username, admin_chat_id, reminders_enabled, review_request_enabled, google_maps_url'
    )
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
  const path = `${req.auth!.salon_id}/${Date.now()}.${ext}`;

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

router.get('/admin/clients', async (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string'
    ? req.query.search.trim().replace(/[,%()]/g, '')
    : '';
  let query = supabase
    .from('clients')
    .select('*')
    .eq('salon_id', req.auth!.salon_id);
  if (search) {
    query = query.or(
      `full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
    );
  }
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const clients = data ?? [];
  if (!clients.length) {
    res.json([]);
    return;
  }
  const { data: visits } = await supabase
    .from('bookings')
    .select('client_id, booking_datetime, status')
    .eq('salon_id', req.auth!.salon_id)
    .in('client_id', clients.map((client) => client.id))
    .neq('status', 'cancelled')
    .order('booking_datetime', { ascending: false });
  const stats = new Map<string, { count: number; last: string | null }>();
  for (const visit of visits ?? []) {
    if (!visit.client_id) continue;
    const current = stats.get(visit.client_id) ?? { count: 0, last: null };
    current.count += 1;
    current.last ??= visit.booking_datetime;
    stats.set(visit.client_id, current);
  }
  res.json(clients.map((client) => ({
    ...client,
    initials: clientInitials(client.full_name),
    visits_count: stats.get(client.id)?.count ?? 0,
    last_visit_at: stats.get(client.id)?.last ?? null,
  })));
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
      salon_id: req.auth!.salon_id,
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
  const salonId = req.auth!.salon_id;
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
    .eq('salon_id', req.auth!.salon_id)
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
  const salonId = req.auth!.salon_id;
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
    const salonId = req.auth!.salon_id;
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
  const salonId = req.auth!.salon_id;
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
  const salonId = req.auth!.salon_id;
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
  let query = supabase
    .from('bookings')
    .select('*, masters(name), services(name_uk, price, duration_minutes), clients(*), booking_notes(*)')
    .eq('salon_id', req.auth!.salon_id);
  if (date) {
    query = query
      .gte('booking_datetime', `${date}T00:00:00`)
      .lte('booking_datetime', `${date}T23:59:59.999`);
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
    .select('id, master_id, booking_datetime, duration_minutes, status')
    .eq('salon_id', req.auth!.salon_id)
    .in('master_id', masterIds)
    .neq('status', 'cancelled');
  if (date) {
    const previousDay = new Date(`${date}T00:00:00`);
    previousDay.setDate(previousDay.getDate() - 1);
    conflictQuery = conflictQuery
      .gte('booking_datetime', previousDay.toISOString())
      .lte('booking_datetime', `${date}T23:59:59.999`);
  }
  const clientIds = [...new Set(bookings.map((booking) => booking.client_id).filter(Boolean))];
  const [{ data: conflictCandidates }, { data: clientFiles }] = await Promise.all([
    conflictQuery,
    clientIds.length
      ? supabase
        .from('client_files')
        .select('client_id')
        .eq('salon_id', req.auth!.salon_id)
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
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const salonId = req.auth!.salon_id;
  let lastCheck = new Date().toISOString();

  const interval = setInterval(async () => {
    const { data } = await supabase
      .from('bookings')
      .select('id, client_name, booking_datetime, updated_at')
      .eq('salon_id', salonId)
      .gt('updated_at', lastCheck);

    if (data?.length) {
      res.write(`data: ${JSON.stringify({ type: 'new_bookings', count: data.length })}\n\n`);
      lastCheck = new Date().toISOString();
    } else {
      res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    }
  }, 15000);

  req.on('close', () => clearInterval(interval));
});

router.post('/admin/bookings', async (req: Request, res: Response) => {
  const salonId = req.auth!.salon_id;
  const { masterId, serviceId, clientId, clientName, clientPhone, datetime, notes } = req.body;
  if (!masterId || !serviceId || !datetime || (!clientId && !clientName)) {
    res.status(400).json({ error: 'masterId, serviceId, datetime and client are required' });
    return;
  }
  const [{ data: master }, { data: service }] = await Promise.all([
    supabase.from('masters').select('id').eq('id', masterId).eq('salon_id', salonId).maybeSingle(),
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
      booking_datetime: datetime,
      duration_minutes: service.duration_minutes,
      status: 'confirmed',
      visit_status: count === 0 ? 'first_visit' : 'scheduled',
      notes: notes ?? null,
    })
    .select('*, masters(name), services(name_uk, price), clients(*), booking_notes(*)')
    .single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create booking' });
    return;
  }
  await supabase.from('booking_notes').insert({
    salon_id: salonId,
    booking_id: data.id,
    author_id: req.auth!.owner_telegram_id,
    body: typeof notes === 'string' && notes.trim() ? notes.trim() : 'Booking created',
  });
  res.status(201).json(withConflictFlags([data])[0]);
});

router.get('/admin/bookings/:id/notes', async (req: Request, res: Response) => {
  const { data: booking } = await supabase
    .from('bookings')
    .select('id')
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id)
    .maybeSingle();
  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }
  const { data, error } = await supabase
    .from('booking_notes')
    .select('*')
    .eq('booking_id', booking.id)
    .eq('salon_id', req.auth!.salon_id)
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
  const salonId = req.auth!.salon_id;
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
      author_id: req.auth!.owner_telegram_id,
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
  const salonId = req.auth!.salon_id;
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
  if (datetime !== undefined) update.booking_datetime = datetime;
  if (client) {
    update.client_id = client.id;
    update.client_name = client.full_name;
    update.client_phone = client.phone;
    update.client_telegram_id = client.telegram_id ?? -Date.now();
  }
  const { data, error } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', existing.id)
    .eq('salon_id', salonId)
    .select('*, masters(name), services(name_uk, price, duration_minutes), clients(*), booking_notes(*)')
    .single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to update booking' });
    return;
  }
  if (notes !== undefined && notes !== existing.notes) {
    await supabase.from('booking_notes').insert({
      salon_id: salonId,
      booking_id: existing.id,
      author_id: req.auth!.owner_telegram_id,
      body: typeof notes === 'string' && notes.trim() ? notes.trim() : 'Notes cleared',
    });
  }
  res.json(withConflictFlags([data])[0]);
});

// Masters CRUD
router.get('/admin/masters', async (req: Request, res: Response) => {
  const { data } = await supabase
    .from('masters')
    .select('id, salon_id, name, photo_url, position, bio, portfolio, is_active')
    .eq('salon_id', req.auth!.salon_id)
    .order('name');
  res.json(
    (data ?? []).map((master) => ({
      ...master,
      bio: master.bio ?? null,
      portfolio: normalizePortfolio(master.portfolio),
    }))
  );
});

router.post('/admin/masters', async (req: Request, res: Response) => {
  const { name, photo_url, position, is_active, bio, portfolio } = req.body;
  const { data, error } = await supabase
    .from('masters')
    .insert({
      salon_id: req.auth!.salon_id,
      name,
      photo_url,
      position,
      is_active,
      bio: normalizeBio(bio),
      portfolio: normalizePortfolio(portfolio),
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
    portfolio: normalizePortfolio(data.portfolio),
  });
});

router.patch('/admin/masters/:id', async (req: Request, res: Response) => {
  const { name, photo_url, position, is_active, bio, portfolio } = req.body;
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (photo_url !== undefined) patch.photo_url = photo_url;
  if (position !== undefined) patch.position = position;
  if (is_active !== undefined) patch.is_active = is_active;
  if (bio !== undefined) patch.bio = normalizeBio(bio);
  if (portfolio !== undefined) patch.portfolio = normalizePortfolio(portfolio);

  const { data, error } = await supabase
    .from('masters')
    .update(patch)
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({
    ...data,
    bio: data.bio ?? null,
    portfolio: normalizePortfolio(data.portfolio),
  });
});

router.delete('/admin/masters/:id', async (req: Request, res: Response) => {
  await supabase
    .from('masters')
    .delete()
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id);
  res.json({ ok: true });
});

router.get('/admin/masters/:id/schedule', async (req: Request, res: Response) => {
  const { data: master } = await supabase
    .from('masters')
    .select('id')
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id)
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
    .eq('salon_id', req.auth!.salon_id)
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
    .eq('salon_id', req.auth!.salon_id)
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
      salon_id: req.auth!.salon_id,
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
      .eq('salon_id', req.auth!.salon_id)
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
    .eq('salon_id', req.auth!.salon_id)
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
        .eq('salon_id', req.auth!.salon_id)
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
    .eq('salon_id', req.auth!.salon_id);
  res.json({ ok: true });
});

export default router;
