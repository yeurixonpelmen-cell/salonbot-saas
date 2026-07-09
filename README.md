# SalonBot SaaS

Multi-tenant SaaS for beauty salons and barbershops:

- Telegram bot for each salon
- Telegram Mini App for client booking
- React admin panel with iClinic-style schedule grid
- Supabase PostgreSQL database
- Railway backend and Vercel frontends

## Stack

- Backend: Node.js + Express + TypeScript
- Bot framework: Grammy
- Database: Supabase PostgreSQL
- Mini App: React + Vite + TypeScript + Tailwind
- Admin: React + Vite + TypeScript + Tailwind

Do not add Python, Django, React Native, Redis, or microservices for the MVP unless explicitly approved.

## Project Structure

```text
backend/      Express API, bot manager, jobs, Supabase client
mini-app/     Telegram Mini App for clients
admin/        Web admin panel for salon owners
supabase/     SQL schema for Supabase
```

## Manual Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Create two Telegram bots via BotFather:
   - one salon/customer bot
   - one login bot for admin auth, e.g. `@salonbot_login_bot`
4. Copy `.env.example` to `.env` for local backend development and fill:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENCRYPTION_KEY`
   - `ADMIN_LOGIN_BOT_TOKEN`
   - `JWT_SECRET`
   - `WEBHOOK_URL`
   - `TELEGRAM_WEBHOOK_SECRET` (optional, recommended in production)
   - `MINI_APP_URL`
   - `ADMIN_URL`

Frontend apps use `VITE_API_URL` and `VITE_LOGIN_BOT_USERNAME`.

## Local Development

Install dependencies from the repository root:

```bash
npm install
```

Run apps separately:

```bash
npm run dev:backend
npm run dev:mini-app
npm run dev:admin
```

Build all packages:

```bash
npm run build
```

## Deployment

Use `DEPLOYMENT.md` for the Railway, Vercel, Supabase, BotFather, and first-salon test checklist.

## Phase Notes

This repository is built in phases from `START_HERE.md`.

Current phase: MVP implementation phases 1-8 are complete in code.
Next phase: install dependencies locally, run full build/typecheck, deploy, and test one salon end to end.
