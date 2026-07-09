# SalonBot SaaS — інструкція для старту

> Збережи цей файл у проєкті. На початку **кожного нового чату** з агентом прикріплюй його або пиши: «Працюй по START_HERE.md, фаза N».

---

## 1. Що будуємо

**SaaS для салонів краси / барбершопів:**

| Хто | Що бачить |
|-----|-----------|
| Клієнт салону | Telegram-бот → Mini App → запис |
| Власник салону | Веб-адмінка з таблицею розкладу (як iClinic) |
| Ти (SaaS) | Підключаєш салони, ~600 грн/міс з клієнта |

**Джерело промптів:** `c:\Users\User\Downloads\cursor_prompts.md` (8 промптів).

**План:** `.cursor/plans/salonbot_saas_plan_*.plan.md`

---

## 2. Стек — НЕ МІНЯТИ

| Частина | Технологія |
|---------|------------|
| Backend | Node.js + Express + **TypeScript** |
| База | **Supabase (PostgreSQL)** |
| Бот | **Grammy** |
| Mini App | React + Vite + TypeScript + Tailwind |
| Адмінка | React + Vite + TypeScript + Tailwind |
| Хостинг | Railway (backend) + Vercel (frontend) |

**Не використовувати:** Python, Django, React Native, окремі Android/iOS додатки.

**Чому:** одна мова (TypeScript), дешево, клієнт записується в Telegram без App Store.

---

## 3. Структура продукту

### Бот
- `/start` → кнопка «Записатись» → Mini App
- `/mybookings` → активні записи
- підтвердження клієнту + сповіщення адміну
- кнопки підтвердити / скасувати

### Mini App (5 екранів)
1. Послуги
2. Майстри (+ «будь-який вільний»)
3. Дата/час
4. Підтвердження (ім'я, телефон)
5. Успіх

### Адмін-панель
- **Розклад** — сітка: колонки = майстри, рядки = час, блоки різної тривалості (rowSpan)
- Статуси: pending (жовтий), confirmed (зелений), cancelled (червоний), completed (сірий)
- Модалка запису, ручне додавання з сітки
- Майстри, послуги, розклад, налаштування
- Онбординг (5 кроків для нового салону)
- Оновлення розкладу: **polling або SSE** (не Supabase Realtime з anon key)

### Таблиці БД
`salons`, `masters`, `services`, `schedules`, `bookings`, `master_services`

---

## 4. Крок 0 — ти робиш руками (перед фазою 1)

1. Акаунт **Supabase** → виконати SQL з `supabase/schema.sql`
2. **BotFather** → 2 боти:
   - бот салону (для клієнтів)
   - login-бот (напр. `@salonbot_login_bot`) — тільки для входу в адмінку
3. Згенерувати: `ENCRYPTION_KEY`, `JWT_SECRET` (довгі випадкові рядки)
4. Пізніше: Railway, Vercel, домени для webhook

Якщо ключів ще немає — агент може зробити код, а ти підключиш ключі пізніше.

---

## 5. Дев'ять фаз — як працювати з агентом

**Схема:** ти пишеш «Фаза N» → агент робить → **короткий звіт** → **зупинка** → ти пишеш «Фаза N+1».

| Фаза | Що робить агент |
|------|-----------------|
| **1** | Monorepo, `schema.sql`, `.env.example`, типи, `.gitignore`, README |
| **2** | BotManager, webhooks `/webhook/:salonId`, handlers |
| **3** | REST API: salon, services, masters, slots, bookings, auth JWT |
| **4** | Mini App: 5 екранів, i18n uk/en, Telegram WebApp |
| **5** | Адмін: Login Widget, **ScheduleGrid як iClinic**, модалки, mobile |
| **6** | Адмін CRUD: майстри, послуги, розклад, налаштування |
| **7** | Онбординг 5 кроків через backend API |
| **8** | Cron нагадування 24h/2h, rate limit, security |
| **9** | `npm install`, збірка, інструкція деплoy, тест 1 салону |

**Не редагувати plan file** — тільки код проєкту.

---

## 6. Підписка $20 (Cursor Pro)

- **Достатньо**, якщо **1 фаза ≈ 1 чат**, без «зроби все за раз»
- **MAX** — тільки на **фазу 5** (адмін-сітка), опційно 3 і 8
- Решта — **GPT-5.5 Medium** або Auto
- Розтягнути на **2–4 тижні** (~2–3 фази на тиждень)
- Після кожної фази: «Зупинись. Короткий звіт.»

---

## 7. Що агент може додавати сам («як у production»)

**Може без погодження:**
- CORS, rate limit, `trust proxy`
- обробка помилок, 409 на зайнятий слот
- timezone `Europe/Kyiv`
- polling/SSE замість Realtime
- loading/error states, health check `/health`

**Не без твого «так»:**
- Python, Django, React Native
- Redis, мікросервіси
- зміна стеку або білінгу

---

## 8. Готові промпти — копіюй

### Фаза 1 (перший запуск)
```
SalonBot SaaS, фаза 1 з 9.
Працюй по START_HERE.md і cursor_prompts.md.
Стек: Node.js + Express + TypeScript, Grammy, React + Vite, Supabase PostgreSQL, Railway, Vercel.
Без Python, Django, React Native.
Створи структуру проєкту (backend/, mini-app/, admin/), supabase/schema.sql, .env.example.
Можеш додати .gitignore і короткий README якщо потрібно.
Якщо в проєкті вже є часткові файли — перевір і дороби, не дублюй.
Після завершення — короткий звіт (що зроблено, що мені підключити руками) і ЗУПИНИСЬ.
```

### Фази 2–9
```
SalonBot SaaS, фаза 2. BotManager, webhooks, handlers /start, /mybookings, admin callbacks. Працюй по START_HERE.md. Звіт і зупинись.
```

```
SalonBot SaaS, фаза 3. REST API + auth JWT + slot engine. Працюй по START_HERE.md. Звіт і зупинись.
```

```
SalonBot SaaS, фаза 4. Mini App 5 екранів, i18n, Telegram WebApp. Працюй по START_HERE.md. Звіт і зупинись.
```

```
SalonBot SaaS, фаза 5. Admin: Login Widget, ScheduleGrid як iClinic (rowSpan), polling/SSE. Працюй по START_HERE.md. Звіт і зупинись.
```

```
SalonBot SaaS, фаза 6. Admin CRUD: майстри, послуги, розклад, налаштування. Працюй по START_HERE.md. Звіт і зупинись.
```

```
SalonBot SaaS, фаза 7. Онбординг 5 кроків через backend API. Працюй по START_HERE.md. Звіт і зупинись.
```

```
SalonBot SaaS, фаза 8. Cron нагадування, rate limit, security audit. Працюй по START_HERE.md. Звіт і зупинись.
```

```
SalonBot SaaS, фаза 9. npm install, перевірка збірки, інструкція деплoy. Працюй по START_HERE.md. Звіт і зупинись.
```

### Новий чат / інша модель
```
Продовжую SalonBot SaaS. Фаза N.
Працюй по START_HERE.md і cursor_prompts.md.
Стек не міняти. Не редагувати plan file. Звіт і зупинись.
```

### Якщо помилка
```
SalonBot SaaS, фаза N. Виправ помилку: [текст помилки].
Не перероблюй інші фази. Працюй по START_HERE.md. Звіт і зупинись.
```

---

## 9. Ринок і ціна (орієнтир)

Конкуренти: Fresha, Booksy, GlossGenius, Square — приблизно **$0–50+/міс**.

**Твоя ціна для старту:** **500–900 грн/міс**, оптимально **600 грн/міс** за салон.

**Інфра на старт:** Supabase free, Vercel free, Railway ~$5–10/міс після trial.

---

## 10. Важливі прогалини (агент має врахувати)

1. Realtime → polling/SSE, не anon Supabase без RLS-політик
2. Webhook: `/webhook/:salonId`, не токен в URL
3. «Будь-який майстер» — auto-assign при бронюванні
4. `reminder_24h_sent`, `reminder_2h_sent` — одразу в schema
5. Drag-and-drop iClinic — **не в MVP**
6. Окремі API: auth, onboarding, settings, logo upload — див. план

---

## 11. Частковий код у проєкті

У папці `курсор про-1` можуть бути **часткові файли** (~60% backend, mini-app, частина admin).
Агент на фазі 1 має **перевірити і доробити**, а не дублювати з нуля.

---

## 12. Чеклист перед «Фаза 1»

- [ ] Прочитав START_HERE.md
- [ ] Обрав модель (Medium; MAX лише на фазу 5)
- [ ] Крок 0 (Supabase + боти) — або «фаза 1 без ключів, тільки код»
- [ ] Новий чат → промпт Фази 1 → після звіту → Фаза 2 → … → Фаза 9

---

## 13. Пам'ять між чатами

- **Файли проєкту** — зберігаються на диску
- **Цей чат** — історія лишається, якщо не відкриваєш новий
- **Нова модель / новий чат** — прикріплюй **START_HERE.md** або встав промпт фази
