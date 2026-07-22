import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './api/routes';
import { botManager } from './bots/BotManager';
import { startReminderJobs } from './jobs/reminders';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.MINI_APP_URL,
  process.env.ADMIN_URL,
  'http://localhost:5173',
  'http://localhost:5174',
].filter(Boolean) as string[];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/webhook/:salonId', async (req, res) => {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    webhookSecret &&
    req.header('x-telegram-bot-api-secret-token') !== webhookSecret
  ) {
    res.sendStatus(401);
    return;
  }

  const handler = botManager.getWebhookHandler(req.params.salonId);
  if (!handler) {
    res.sendStatus(404);
    return;
  }
  return handler(req, res);
});

app.use('/api', apiRoutes);

async function main() {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });

  console.log('Starting SalonBot backend...');
  console.log('PORT:', PORT);

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  startReminderJobs();

  try {
    await botManager.initAllBots();
  } catch (err) {
    console.error('Bot initialization failed:', err);
  }
}

main().catch(console.error);
