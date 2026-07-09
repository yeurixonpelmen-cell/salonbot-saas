import { supabase } from '../db/client';

export async function getSalonBotToken(salonId: string): Promise<string | null> {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;

  const { data, error } = await supabase.rpc('get_active_salons_decrypted', { p_key: key });
  if (error || !data) return null;

  const salon = (data as { id: string; bot_token: string }[]).find((s) => s.id === salonId);
  return salon?.bot_token ?? null;
}

export async function encryptBotToken(token: string): Promise<string | null> {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;

  const { data, error } = await supabase.rpc('encrypt_token', { token, key });
  if (error) return null;
  return data as string;
}
