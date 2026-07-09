# Deployment And First Salon Test

This is the practical checklist for launching the MVP after the code builds locally.

## 1. Local Verification

From the repository root:

```bash
npm install
npm run build
```

If you want to run each app separately:

```bash
npm --workspace backend run typecheck
npm --workspace mini-app run build
npm --workspace admin run build
```

## 2. Supabase

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Create a public Storage bucket named `logos`.
4. Copy these values for Railway:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

Keep `SUPABASE_SERVICE_ROLE_KEY` only on the backend. Do not add it to Vercel frontend variables.

## 3. Telegram Bots

Create two bots with BotFather:

1. Salon/customer bot: clients press `/start`, open Mini App, and receive reminders.
2. Admin login bot: used by the Telegram Login Widget in the admin panel.

For the customer bot, set the Mini App URL after Vercel deploy:

```text
https://your-mini-app.vercel.app/?salon=<salon_id>
```

For the login bot, configure domain access in BotFather for the admin panel domain.

## 4. Railway Backend

Deploy the repository to Railway and set the backend root to `backend`.

Build command:

```bash
npm install && npm --workspace backend run build
```

Start command:

```bash
npm --workspace backend run start
```

Environment variables:

```dotenv
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ENCRYPTION_KEY=...
JWT_SECRET=...
JWT_EXPIRES_IN=7d
ADMIN_LOGIN_BOT_TOKEN=...
WEBHOOK_URL=https://your-backend.railway.app
TELEGRAM_WEBHOOK_SECRET=...
MINI_APP_URL=https://your-mini-app.vercel.app
ADMIN_URL=https://your-admin.vercel.app
CRON_ENABLED=true
TZ=Europe/Kyiv
```

After deploy, check:

```text
https://your-backend.railway.app/health
```

It should return:

```json
{ "status": "ok" }
```

## 5. Vercel Frontends

Deploy two Vercel projects from the same repository.

Mini App:

- Root directory: `mini-app`
- Build command: `npm run build`
- Output directory: `dist`
- Env: `VITE_API_URL=https://your-backend.railway.app`

Admin:

- Root directory: `admin`
- Build command: `npm run build`
- Output directory: `dist`
- Env:
  - `VITE_API_URL=https://your-backend.railway.app`
  - `VITE_LOGIN_BOT_USERNAME=your_login_bot_username_without_at`

## 6. First Salon Test

Use one real test salon and one test Telegram account.

1. Open the admin panel.
2. Log in through the Telegram Login Widget.
3. Complete onboarding:
   - salon name
   - address
   - logo
   - customer bot token
   - admin notification chat id
4. Add at least one master.
5. Add at least one service and assign it to the master.
6. Add the master's weekly schedule.
7. Open the customer bot, press `/start`, and open the Mini App.
8. Create a booking.
9. Confirm that:
   - the client gets a Telegram confirmation
   - the admin chat gets a new booking message
   - the booking appears in the admin schedule grid
   - changing status in admin works
   - double booking returns "Цей час вже зайнятий. Оберіть інший."

Reminder test:

1. Temporarily create a booking about 2 hours ahead.
2. Keep `CRON_ENABLED=true`.
3. Wait up to 15 minutes.
4. Confirm the reminder arrives and `reminder_2h_sent` becomes `true`.

## 7. Known MVP Limits

- One Railway backend instance is expected. Multiple instances would need a queue/lock for cron jobs and bot management.
- Billing is not implemented yet. Start with manual invoices.
- Drag-and-drop schedule editing is not part of the MVP.
