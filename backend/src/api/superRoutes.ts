import { Router, Request, Response } from 'express';
import { supabase } from '../db/client';
import { superAuthMiddleware } from '../middleware/superAuth';
import { signJwt } from '../utils/jwt';
import { encryptBotToken } from '../utils/salon';
import { botManager } from '../bots/BotManager';
import {
  generateTempPassword,
  hashPassword,
  normalizeEmail,
} from '../utils/password';
import { sendStaffInviteEmail } from '../utils/email';

const router = Router();

function requireSuperPasswordConfigured(res: Response): string | null {
  const password = process.env.SUPER_ADMIN_PASSWORD?.trim();
  if (!password) {
    res.status(503).json({ error: 'SUPER_ADMIN_PASSWORD не налаштовано на сервері' });
    return null;
  }
  return password;
}

router.post('/login', async (req: Request, res: Response) => {
  const expected = requireSuperPasswordConfigured(res);
  if (!expected) return;

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password !== expected) {
    res.status(401).json({ error: 'Невірний пароль' });
    return;
  }

  const token = signJwt({ role: 'super' });
  res.json({ token });
});

router.use(superAuthMiddleware);

router.get('/salons', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('salons')
    .select('id, name_uk, name_en, address, bot_username, is_active, created_at, timezone')
    .order('created_at', { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const salonIds = (data ?? []).map((s) => s.id);
  const { data: staffRows } = salonIds.length
    ? await supabase.from('salon_staff').select('salon_id, email, is_active').in('salon_id', salonIds)
    : { data: [] as { salon_id: string; email: string; is_active: boolean }[] };

  const staffBySalon = new Map<string, { email: string; is_active: boolean }[]>();
  for (const row of staffRows ?? []) {
    const list = staffBySalon.get(row.salon_id) ?? [];
    list.push({ email: row.email, is_active: row.is_active });
    staffBySalon.set(row.salon_id, list);
  }

  res.json(
    (data ?? []).map((salon) => ({
      ...salon,
      staff: staffBySalon.get(salon.id) ?? [],
      staff_count: (staffBySalon.get(salon.id) ?? []).length,
    }))
  );
});

router.post('/salons', async (req: Request, res: Response) => {
  const {
    name_uk,
    name_en,
    address,
    botToken,
    botUsername,
    adminChatId,
    timezone,
    staffEmails,
  } = req.body as {
    name_uk?: string;
    name_en?: string;
    address?: string;
    botToken?: string;
    botUsername?: string;
    adminChatId?: string;
    timezone?: string;
    staffEmails?: string[];
  };

  if (!name_uk?.trim()) {
    res.status(400).json({ error: 'Назва салону обов’язкова' });
    return;
  }
  if (!botToken?.trim()) {
    res.status(400).json({ error: 'Токен Telegram-бота обов’язковий' });
    return;
  }

  const encryptedToken = await encryptBotToken(botToken.trim());
  if (!encryptedToken) {
    res.status(500).json({ error: 'Не вдалось зашифрувати токен (перевір ENCRYPTION_KEY)' });
    return;
  }

  const { data: salon, error } = await supabase
    .from('salons')
    .insert({
      name_uk: name_uk.trim(),
      name_en: name_en?.trim() || null,
      address: address?.trim() || null,
      bot_token: encryptedToken,
      bot_username: botUsername?.trim()?.replace(/^@/, '') || null,
      admin_chat_id: adminChatId?.trim() || null,
      owner_telegram_id: 0,
      timezone: timezone?.trim() || 'Europe/Kyiv',
      is_active: true,
    })
    .select('id, name_uk, name_en, address, bot_username, is_active, created_at, timezone')
    .single();

  if (error || !salon) {
    res.status(500).json({ error: error?.message ?? 'Не вдалось створити салон' });
    return;
  }

  try {
    await botManager.addBot(botToken.trim(), salon.id);
  } catch (err) {
    console.error('Failed to start bot for new salon', err);
  }

  const createdStaff: {
    email: string;
    temporaryPassword: string;
    full_name: string | null;
    emailSent: boolean;
    emailError?: string;
  }[] = [];
  const emails = Array.isArray(staffEmails) ? staffEmails : [];
  for (const raw of emails) {
    const email = normalizeEmail(String(raw ?? ''));
    if (!email || !email.includes('@')) continue;
    const temporaryPassword = generateTempPassword();
    const { error: staffError } = await supabase.from('salon_staff').insert({
      salon_id: salon.id,
      email,
      password_hash: hashPassword(temporaryPassword),
      full_name: null,
      role: createdStaff.length === 0 ? 'owner' : 'admin',
      is_active: true,
    });
    if (!staffError) {
      const mail = await sendStaffInviteEmail({
        to: email,
        salonName: salon.name_uk,
        temporaryPassword,
      });
      createdStaff.push({
        email,
        temporaryPassword,
        full_name: null,
        emailSent: mail.sent,
        emailError: mail.error,
      });
    }
  }

  res.status(201).json({ salon, staff: createdStaff });
});

router.get('/salons/:id/staff', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('salon_staff')
    .select('id, email, full_name, role, is_active, created_at')
    .eq('salon_id', req.params.id)
    .order('created_at');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

router.post('/salons/:id/staff', async (req: Request, res: Response) => {
  const email = normalizeEmail(String(req.body?.email ?? ''));
  const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Коректний email обов’язковий' });
    return;
  }

  const { data: salon } = await supabase
    .from('salons')
    .select('id, name_uk')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!salon) {
    res.status(404).json({ error: 'Салон не знайдено' });
    return;
  }

  const temporaryPassword = generateTempPassword();
  const { data, error } = await supabase
    .from('salon_staff')
    .insert({
      salon_id: salon.id,
      email,
      password_hash: hashPassword(temporaryPassword),
      full_name: fullName || null,
      role: 'admin',
      is_active: true,
    })
    .select('id, email, full_name, role, is_active, created_at')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const mail = await sendStaffInviteEmail({
    to: email,
    salonName: salon.name_uk,
    temporaryPassword,
  });
  res.status(201).json({
    ...data,
    temporaryPassword,
    emailSent: mail.sent,
    emailError: mail.error,
  });
});

router.patch('/salons/:id/staff/:staffId', async (req: Request, res: Response) => {
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.is_active === 'boolean') patch.is_active = req.body.is_active;
  if (typeof req.body?.full_name === 'string') patch.full_name = req.body.full_name.trim() || null;
  if (req.body?.resetPassword === true) {
    const temporaryPassword = generateTempPassword();
    patch.password_hash = hashPassword(temporaryPassword);
    const [{ data, error }, salonRes] = await Promise.all([
      supabase
        .from('salon_staff')
        .update(patch)
        .eq('id', req.params.staffId)
        .eq('salon_id', req.params.id)
        .select('id, email, full_name, role, is_active, created_at')
        .single(),
      supabase.from('salons').select('name_uk').eq('id', req.params.id).maybeSingle(),
    ]);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const mail = await sendStaffInviteEmail({
      to: data.email,
      salonName: salonRes.data?.name_uk ?? 'SalonBot',
      temporaryPassword,
    });
    res.json({
      ...data,
      temporaryPassword,
      emailSent: mail.sent,
      emailError: mail.error,
    });
    return;
  }

  const { data, error } = await supabase
    .from('salon_staff')
    .update(patch)
    .eq('id', req.params.staffId)
    .eq('salon_id', req.params.id)
    .select('id, email, full_name, role, is_active, created_at')
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

router.patch('/salons/:id', async (req: Request, res: Response) => {
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.is_active === 'boolean') patch.is_active = req.body.is_active;
  if (typeof req.body?.name_uk === 'string') patch.name_uk = req.body.name_uk.trim();
  if (typeof req.body?.admin_chat_id === 'string') patch.admin_chat_id = req.body.admin_chat_id.trim() || null;

  const { data, error } = await supabase
    .from('salons')
    .update(patch)
    .eq('id', req.params.id)
    .select('id, name_uk, name_en, address, bot_username, is_active, created_at, timezone')
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  if (typeof req.body?.is_active === 'boolean' && req.body.is_active === false) {
    try {
      await botManager.removeBot(req.params.id);
    } catch (err) {
      console.error('Failed to stop bot after deactivating salon', err);
    }
  }

  res.json(data);
});

router.delete('/salons/:id', async (req: Request, res: Response) => {
  const salonId = req.params.id;

  const { data: salon, error: salonLookupError } = await supabase
    .from('salons')
    .select('id, name_uk')
    .eq('id', salonId)
    .maybeSingle();
  if (salonLookupError) {
    res.status(500).json({ error: salonLookupError.message });
    return;
  }
  if (!salon) {
    res.status(404).json({ error: 'Салон не знайдено' });
    return;
  }

  try {
    await botManager.removeBot(salonId);
  } catch (err) {
    console.error('Failed to stop bot before deleting salon', err);
  }

  // bookings.salon_id has no ON DELETE CASCADE — delete bookings first
  const { error: bookingsError } = await supabase.from('bookings').delete().eq('salon_id', salonId);
  if (bookingsError) {
    res.status(500).json({ error: bookingsError.message });
    return;
  }

  const { error } = await supabase.from('salons').delete().eq('id', salonId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true, id: salonId, name_uk: salon.name_uk });
});

export default router;
