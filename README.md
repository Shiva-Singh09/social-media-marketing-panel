# 🚀 SMM Panel — Full-stack Social Media Marketing Panel

A production-style SMM (Social Media Marketing) reseller panel: public marketing site, customer
dashboard with wallet + orders, Razorpay top-ups with server-side signature verification, ticket
support, and a complete admin console.

> **Stack note.** This project implements the original brief — Next.js + **MongoDB/Mongoose** —
> as one deployable Next.js app using Route Handlers for the REST API. Every documented
> endpoint (`/api/auth/*`, `/api/user/*`, `/api/services/*`, `/api/orders`, `/api/payment/*`,
> `/api/support/*`, `/api/admin/*`) exists and behaves identically. The old PostgreSQL/Drizzle
> schema (`src/db/schema.ts`) has been kept for reference only; the live data layer lives in
> `src/db/mongodb-schema.ts`.

---

## ✨ Features

**Public**
- Dark, gradient themed landing page with live cheapest-rate widget pulled from the DB
- Full services & pricing catalogue, About page, FAQ

**Customer dashboard**
- Animated stats (wallet balance, orders, completed, lifetime spend), 7-day spend chart
- New order flow: category → service → link → quantity with live cost calculation
- Orders list with search, status filter, pagination (cards on mobile) + order detail with
  delivery progress, start count, remains and admin notes
- Add funds: preset/custom amounts, Razorpay checkout, transaction history
- Support tickets with threaded replies
- Profile management + bcrypt password change

**Admin console**
- Overview: revenue chart, wallet liability, top services, latest orders, pending alerts
- Users: search, pagination, block/unblock, role change, manual balance adjustments (logged as
  transactions), delete
- Categories & services CRUD (services fall back to *inactive* when orders reference them)
- Orders: status workflow with **automatic wallet refunds** on `cancelled` / `failed`
- Transactions ledger with credit/debit totals and Razorpay ids
- Support inbox with replies + status control
- Site settings (branding, minimum top-up, announcement banner, maintenance mode) and a live
  integration status panel

---

## 🧰 Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript) |
| Styling | Tailwind CSS v4, custom dark theme, Inter font |
| UI | Hand-rolled shadcn-style primitives (`src/components/ui.tsx`), lucide-react icons |
| Notifications | react-hot-toast |
| State | React Context (`src/context/AuthContext.tsx`) |
| Database | MongoDB + Mongoose (`src/db/mongodb-schema.ts`) |
| Auth | JWT (jose, HS256, 7-day expiry) in an httpOnly cookie **or** `Authorization: Bearer` |
| Passwords | bcryptjs, 12 salt rounds, 8-char minimum |
| Validation | zod schemas (`src/lib/validators.ts`) + input sanitising |
| Payments | Razorpay REST API + HMAC-SHA256 signature verification + webhook fallback |

---

## 🗄️ Data model (`src/db/mongodb-schema.ts`)

Mongoose collections: `users`, `categories`, `services`, `orders`, `transactions`,
`supportTickets` (with embedded `replies`), `rateLimitBuckets`, `siteSettings`,
`adminAuditLogs` — a 1:1 translation of the original brief (`creditBalance`, `pricePer1000`,
`startCount`, `remains`, `razorpayPaymentId`, …). The old Drizzle/Postgres schema remains at
`src/db/schema.ts` for reference only.

---

## 🔌 API reference

All responses use the envelope `{ success, data, message }`.

### Auth (`/api/auth`)
| Method | Path | Description |
| --- | --- | --- |
| POST | `/register` | Create account (rate limited) |
| POST | `/login` | Email + password, sets JWT cookie |
| POST | `/logout` | Clears the session cookie |
| GET | `/me` | Current user + public site settings |
| POST | `/forgot-password` | Issues a 60-minute reset token (emailed or returned in dev) |
| POST | `/reset-password` | Consumes the token, re-hashes the password |
| GET | `/verify-email/:token` | Marks the email verified |
| GET | `/google` | Redirect to Google consent (OAuth code flow) |
| GET | `/google/callback` | Code exchange → session |
| POST | `/google` | Google One-Tap `credential` login |

### User (`/api/user`)
`GET|PUT /profile`, `PUT /change-password`, `GET /dashboard-stats`

### Services (`/api/services`)
`GET /categories[?withServices=1]`, `GET /:categoryId`, `GET /detail/:id`

### Orders (`/api/orders`)
`POST /` (server-side pricing + atomic debit), `GET /?page&limit&status&search`, `GET /:id`

### Payments (`/api/payment`)
`POST /create-order`, `POST /verify`, `POST /webhook`, `GET /history`

### Support (`/api/support`)
`POST /`, `GET /`, `GET /:id`, `POST /:id/reply`

### Admin (`/api/admin`) — admin role required
`GET /dashboard` · `GET /users` · `GET|PUT|DELETE /users/:id` ·
`GET|POST /categories` · `PUT|DELETE /categories/:id` ·
`GET|POST /services` · `PUT|DELETE /services/:id` ·
`GET /orders` · `PUT /orders/:id` · `GET /transactions` ·
`GET /support` · `GET|POST|PUT /support/:id` · `GET|PUT /settings`

---

## 🔐 Security

- **Passwords** — bcrypt (12 rounds), minimum 8 characters, never returned by any endpoint.
- **JWT** — HS256, 7-day expiry, httpOnly + SameSite=Lax cookie (Secure in production); Bearer
  tokens accepted for API clients.
- **Validation** — every request body is parsed with zod; URLs, emails, quantities and amounts are
  checked and text is sanitised before storage.
- **Rate limiting** — login 5/15min, register 5/hour, orders 10/min/user, payments 5/min/user,
  tickets 5/min/user (`src/lib/rate-limit.ts`), backed by the `rateLimitBuckets` collection.
- **Payments** — the client result is never trusted. `create-order` logs a *pending* transaction,
  `verify` recomputes `HMAC_SHA256(order_id|payment_id, key_secret)` and only then credits the
  wallet; the webhook (`x-razorpay-signature` verified) is an idempotent backup path. All attempts,
  successes and failures are stored.
- **Orders** — pricing is recalculated server-side and the debit + order + ledger row run inside an
  atomic MongoDB session with a `creditBalance >= cost` guard, so balances can never go negative.
- **Route protection** — `src/middleware.ts` bounces anonymous users; every API route re-verifies
  the JWT and the admin role.

---

## 💳 Payment flow

1. Customer picks an amount (≥ `minCreditAmount`, default ₹50).
2. `POST /api/payment/create-order` → Razorpay order + pending transaction row.
3. Razorpay Checkout opens in the browser (script loaded on demand).
4. `POST /api/payment/verify` validates the signature → wallet credited, transaction marked
   `success`; an invalid signature marks it `failed`.
5. `POST /api/payment/webhook` (`payment.captured`) credits the wallet if step 4 never happened.

**Demo mode** — when `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are absent the panel simulates the
checkout: the server signs its own receipt and the identical verification path runs, so the whole
add-funds journey is testable without live keys.

---

## ⚙️ Getting started

```bash
npm install
cp .env.example .env            # or edit the generated .env
npm run dev                     # http://localhost:3000
```

Seed data (admin, demo user, 6 categories, 15 services, site settings) is inserted automatically
and idempotently on first boot (`src/lib/seed.ts`, triggered from `src/instrumentation.ts` and the
auth routes).

### Environment variables

| Key | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | JWT signing secret (256-bit recommended) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ | Bootstrap admin credentials (seeded on first boot) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | — | Live Razorpay checkout (demo mode without them) |
| `RAZORPAY_WEBHOOK_SECRET` | — | Webhook signature secret |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | — | Public key used by the browser checkout |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | "Continue with Google" |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | — | Password-reset emails |
| `FRONTEND_URL` | — | Base URL used in emails |
| `SEED_DEMO_USER` / `DEMO_EMAIL` / `DEMO_PASSWORD` | — | Optional demo account seeding |

### Default accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | set via `ADMIN_EMAIL` / `ADMIN_PASSWORD` | configured by you |
| Customer | set via `DEMO_EMAIL` / `DEMO_PASSWORD` | configured by you (₹500 starting balance) |

---

## 🧭 Third-party setup

**MongoDB** — local (`mongodb://localhost:27017/smm_panel`) or a free Atlas cluster; set the
`MONGODB_URI` in `.env`. Collections are created automatically on first write (or by `scripts/setup-mongodb.sh`).

**Razorpay** — create a free account → *Settings → API Keys → Generate* → put the key id/secret in
`.env`, expose the key id as `NEXT_PUBLIC_RAZORPAY_KEY_ID`, then add a webhook pointing at
`https://your-domain/api/payment/webhook` for the `payment.captured` event and store its secret in
`RAZORPAY_WEBHOOK_SECRET`.

**Google OAuth** — Google Cloud Console → *APIs & Services → Credentials → OAuth client ID (Web)* →
authorised redirect URI `https://your-domain/api/auth/google/callback`.

---

## 🚢 Deployment

Deploy to Vercel (or any Node host) and point `MONGODB_URI` at a managed MongoDB instance
(Atlas / Railway / MongoLab — all have free tiers). Set the environment variables above, and the
seed runs on first boot.

## 📁 Project structure

```
src/
├── app/
│   ├── (public)/          # landing, services, about
│   ├── (auth)/            # login, register, forgot/reset password
│   ├── (dashboard)/       # customer panel (sidebar shell)
│   ├── (admin)/admin/     # admin console (sidebar shell)
│   └── api/               # auth, user, services, orders, payment, support, admin, health
├── components/            # ui primitives, navbar, footer, shell, stats, payment button
├── context/AuthContext.tsx
├── db/                    # mongoose schemas + connection (mongodb-schema.ts, index.ts)
├── lib/                   # auth, api envelope, validators, rate limit, razorpay, mailer, seed
└── middleware.ts