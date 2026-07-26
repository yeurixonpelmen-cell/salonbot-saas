export type StaffInviteEmailInput = {
  to: string;
  salonName: string;
  temporaryPassword: string;
};

export type ActivationCodeEmailInput = {
  to: string;
  code: string;
};

export type SendEmailResult = {
  sent: boolean;
  error?: string;
  skipped?: boolean;
};

function adminLoginUrl(): string {
  const base = (process.env.ADMIN_URL ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/login` : '/login';
}

function adminOnboardingUrl(): string {
  const base = (process.env.ADMIN_URL ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/onboarding` : '/onboarding';
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendActivationCodeEmail(input: ActivationCodeEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { sent: false, skipped: true, error: 'RESEND_API_KEY не налаштовано' };
  }

  const from =
    process.env.EMAIL_FROM?.trim() ||
    'SalonBot <onboarding@resend.dev>';
  const onboardingUrl = adminOnboardingUrl();

  const subject = 'Ваш код активації SalonBot';
  const text = [
    'Вітаємо! Вам надіслано код для підключення салону до SalonBot.',
    '',
    `Код активації: ${input.code}`,
    `Посилання: ${onboardingUrl}`,
    '',
    '1) Відкрийте посилання',
    '2) Введіть код, цей email і придумайте пароль',
    '3) Далі самі налаштуйте назву салону та Telegram-бота',
    '',
    'Один код = один салон. Нікому не пересилайте код.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <p>Вітаємо! Вам надіслано код для підключення салону до <b>SalonBot</b>.</p>
      <p style="font-size:18px"><b>Код активації:</b> <code style="font-size:20px;letter-spacing:0.04em">${escapeHtml(input.code)}</code></p>
      <p><b>Посилання:</b> <a href="${escapeHtml(onboardingUrl)}">${escapeHtml(onboardingUrl)}</a></p>
      <ol>
        <li>Відкрийте посилання</li>
        <li>Введіть код, <b>цей email</b> (${escapeHtml(input.to)}) і придумайте пароль</li>
        <li>Далі самі налаштуйте назву салону та Telegram-бота</li>
      </ol>
      <p style="color:#555;font-size:13px">Один код = один салон. Нікому не пересилайте код.</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject,
        text,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Resend error', res.status, body);
      return { sent: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('Resend request failed', err);
    return { sent: false, error: err instanceof Error ? err.message : 'Email send failed' };
  }
}

export async function sendStaffInviteEmail(input: StaffInviteEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { sent: false, skipped: true, error: 'RESEND_API_KEY не налаштовано' };
  }

  const from =
    process.env.EMAIL_FROM?.trim() ||
    'SalonBot <onboarding@resend.dev>';
  const loginUrl = adminLoginUrl();

  const subject = `Доступ до адмінки: ${input.salonName}`;
  const text = [
    `Вам відкрито доступ до адмінки «${input.salonName}».`,
    '',
    `Вхід: ${loginUrl}`,
    `Email: ${input.to}`,
    `Тимчасовий пароль: ${input.temporaryPassword}`,
    '',
    'Увійдіть вкладкою Email і змініть пароль після першого входу (або зверніться до власника платформи для скидання).',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <p>Вам відкрито доступ до адмінки <b>${escapeHtml(input.salonName)}</b>.</p>
      <p>
        <b>Вхід:</b> <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a><br/>
        <b>Email:</b> ${escapeHtml(input.to)}<br/>
        <b>Тимчасовий пароль:</b> <code style="font-size:16px">${escapeHtml(input.temporaryPassword)}</code>
      </p>
      <p style="color:#555;font-size:13px">Увійдіть вкладкою Email. Збережіть пароль у надійному місці.</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject,
        text,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Resend error', res.status, body);
      return { sent: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('Resend request failed', err);
    return { sent: false, error: err instanceof Error ? err.message : 'Email send failed' };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
