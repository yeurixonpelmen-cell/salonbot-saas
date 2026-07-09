import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { supabase } from '../db/client';
import { authMiddleware } from '../middleware/auth';
import { telegramInitDataMiddleware } from '../middleware/telegramInitData';
import { validateTelegramLoginWidget, isBookingConflictError } from '../utils/telegram';
import { signJwt, signSalonSelectionJwt, verifySalonSelectionJwt } from '../utils/jwt';
import { encryptBotToken } from '../utils/salon';
import {
  generateSlots,
  findAvailableMaster,
  isSlotAvailable,
} from '../utils/slots';
import { sendBookingNotifications } from '../bots/notifications';
import { botManager } from '../bots/BotManager';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
    .select('id, name, photo_url, position')
    .in('id', masterIds)
    .eq('salon_id', req.params.salonId)
    .eq('is_active', true);

  res.json(data ?? []);
});

router.get(
  '/salons/:salonId/slots',
  telegramInitDataMiddleware,
  async (req: Request, res: Response) => {
    const masterId = (req.query.masterId as string) || null;
    const serviceId = req.query.serviceId as string;
    if (!serviceId) {
      res.status(400).json({ error: 'serviceId required' });
      return;
    }

    const slots = await generateSlots(req.params.salonId, masterId, serviceId);
    res.json(slots);
  }
);

router.post('/bookings', bookingLimiter, telegramInitDataMiddleware, async (req: Request, res: Response) => {
  let { salonId, masterId, serviceId, clientName, clientPhone, datetime } = req.body;
  const clientTelegramId = req.telegramUser!.id;

  if (!salonId || !serviceId || !clientName || !datetime) {
    res.status(400).json({ error: 'Missing required fields' });
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

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      salon_id: salonId,
      master_id: masterId,
      service_id: serviceId,
      client_telegram_id: clientTelegramId,
      client_name: clientName,
      client_phone: clientPhone ?? null,
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
    clientPhone ?? null,
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
    .select('id, name_uk, name_en, address, logo_url, bot_username, admin_chat_id')
    .eq('id', req.auth!.salon_id)
    .single();

  res.json(data);
});

router.patch('/admin/salon', async (req: Request, res: Response) => {
  const { name_uk, name_en, address, logo_url, admin_chat_id } = req.body;
  const { data, error } = await supabase
    .from('salons')
    .update({ name_uk, name_en, address, logo_url, admin_chat_id })
    .eq('id', req.auth!.salon_id)
    .select()
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

router.get('/admin/bookings', async (req: Request, res: Response) => {
  const date = req.query.date as string;
  const masterId = req.query.masterId as string | undefined;
  const status = req.query.status as string | undefined;

  let query = supabase
    .from('bookings')
    .select('*, masters(name), services(name_uk, price, duration_minutes)')
    .eq('salon_id', req.auth!.salon_id);

  if (date) {
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    query = query.gte('booking_datetime', start).lte('booking_datetime', end);
  }
  if (masterId) query = query.eq('master_id', masterId);
  if (status) query = query.eq('status', status);

  const { data } = await query.order('booking_datetime');
  res.json(
    (data ?? []).map((b) => ({
      id: b.id,
      client_name: b.client_name,
      client_phone: b.client_phone,
      master_id: b.master_id,
      master_name: (b.masters as { name: string } | null)?.name,
      service_name: (b.services as { name_uk: string } | null)?.name_uk,
      service_price: (b.services as { price: number } | null)?.price,
      duration_minutes: b.duration_minutes,
      datetime: b.booking_datetime,
      status: b.status,
      notes: b.notes,
    }))
  );
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
  const { masterId, serviceId, clientName, clientPhone, datetime, notes } = req.body;

  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .eq('salon_id', req.auth!.salon_id)
    .single();

  if (!service) {
    res.status(400).json({ error: 'Service not found' });
    return;
  }

  if (!(await isSlotAvailable(req.auth!.salon_id, masterId, serviceId, datetime))) {
    res.status(409).json({ error: 'Цей час вже зайнятий. Оберіть інший.' });
    return;
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      salon_id: req.auth!.salon_id,
      master_id: masterId,
      service_id: serviceId,
      client_telegram_id: -Date.now(),
      client_name: clientName,
      client_phone: clientPhone ?? null,
      booking_datetime: datetime,
      duration_minutes: service.duration_minutes,
      status: 'confirmed',
      notes: notes ?? null,
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

  res.json({ id: data.id });
});

router.patch('/admin/bookings/:id', async (req: Request, res: Response) => {
  const { status, notes } = req.body;
  const update: Record<string, unknown> = {};
  if (status) {
    if (!['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    update.status = status;
  }
  if (notes !== undefined) update.notes = notes;

  const { data, error } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

// Masters CRUD
router.get('/admin/masters', async (req: Request, res: Response) => {
  const { data } = await supabase
    .from('masters')
    .select('id, salon_id, name, photo_url, position, is_active')
    .eq('salon_id', req.auth!.salon_id)
    .order('name');
  res.json(data ?? []);
});

router.post('/admin/masters', async (req: Request, res: Response) => {
  const { name, photo_url, position, is_active } = req.body;
  const { data, error } = await supabase
    .from('masters')
    .insert({ salon_id: req.auth!.salon_id, name, photo_url, position, is_active })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

router.patch('/admin/masters/:id', async (req: Request, res: Response) => {
  const { name, photo_url, position, is_active } = req.body;
  const { data, error } = await supabase
    .from('masters')
    .update({ name, photo_url, position, is_active })
    .eq('id', req.params.id)
    .eq('salon_id', req.auth!.salon_id)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
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
