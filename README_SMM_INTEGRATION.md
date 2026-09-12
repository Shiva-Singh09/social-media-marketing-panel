# SMM API Integration — Next.js 16 + TypeScript

Production-ready integration of the **ethicalsmm.com API v2** into this panel.
It delivers three facilities:

| Facility | Endpoint(s) | Module |
|---|---|---|
| **Scheduling posts** (+ provider boosts) | `POST/GET/DELETE /api/posts/schedule`, `POST /api/posts/process` | `src/lib/scheduler.ts` |
| **Fetching analytics** (likes, comments, reach) | `GET/POST /api/analytics/fetch` | `src/lib/smm-client.ts` |
| **Managing multiple accounts** | `GET/POST/PATCH/DELETE /api/accounts/manage` | `src/lib/crypto.ts` |

---

## 1. Architecture

```
Browser / Postman
   │  JWT (cookie or Authorization: Bearer) + CSRF double-submit header
   ▼
Next.js proxy (src/proxy.ts)          ← CSRF, session gate, CSP
   ▼
Route handlers (src/app/api/**)       ← zod validation, rate limits, ownership checks
   ▼
lib layer                             ← smm-client │ scheduler │ crypto │ validators
   ▼
MongoDB (Mongoose models in src/db/mongodb-schema.ts)
   ▼
SMM Provider (https://ethicalsmm.com/api/v2)   ← key/action RPC, form-encoded POST
```

### New files

```
src/lib/smm-client.ts        Provider client: services/add/status/refill/balance
src/lib/smm-validators.ts    Zod schemas for every SMM endpoint
src/lib/scheduler.ts         Due-post worker (atomic claim → place boost order)
src/lib/crypto.ts            AES-256-GCM encryption for account tokens at rest
src/app/api/posts/schedule/route.ts    Schedule / list / cancel posts
src/app/api/posts/process/route.ts     Cron worker that publishes due posts
src/app/api/analytics/fetch/route.ts   Query analytics + ingest snapshots
src/app/api/accounts/manage/route.ts   Connect / update / disconnect accounts
src/components/smm/*.tsx     React 19 + Tailwind UI components
src/app/(dashboard)/smm-studio/page.tsx  Composed demo page (/smm-studio)
```

### Modified files

- `src/db/mongodb-schema.ts` — added `SocialAccount`, `ScheduledPost`, `AnalyticsSnapshot`
  models/collections (`socialAccounts`, `scheduledPosts`, `analyticsSnapshots`).
- `src/db/index.ts` — re-exports the new models.
- `src/lib/rate-limit.ts` — added `schedule`, `analytics`, `accounts`, `smmProcess` rules.
- `src/proxy.ts` — `/smm-studio` page gate; `/api/posts/process` CSRF exemption (server-to-server).
- `.env.example` — `SMM_API_URL`, `SMM_API_KEY`, `ACCOUNT_ENCRYPTION_KEY`, `CRON_SECRET`.

---

## 2. Environment configuration

Copy `.env.example` → `.env` and fill in:

```bash
# Required for the SMM integration
SMM_API_URL=https://ethicalsmm.com/api/v2
SMM_API_KEY=your-provider-api-key          # the `key` parameter of the RPC API
ACCOUNT_ENCRYPTION_KEY=<48-byte hex>       # encrypts social-account tokens at rest
CRON_SECRET=<random string>                # auth for POST /api/posts/process

# Generate strong secrets with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Secrets are loaded via `dotenv` (Next.js loads `.env` automatically). **Nothing is
hardcoded** — the app refuses to call the provider without `SMM_API_KEY` and
refuses to store tokens without an encryption key.

---

## 3. Run locally

```bash
npm install          # install dependencies
# ensure MongoDB is running locally or set MONGODB_URI to Atlas
npm run dev          # http://localhost:3000
```

Sign up at `/register` (or use the seeded demo account), then open
**`/smm-studio`** for the full UI: connect accounts → schedule posts → view analytics.

#### Troubleshooting: "This MongoDB deployment does not support retryable writes"

Multi-document transactions (used for atomic credit deduction/crediting) require
a **replica set** — a plain standalone `mongod` cannot run them. The app handles
this gracefully:

- **Recommended (full ACID):** run a single-node replica set locally:
  ```bash
  mongod --replSet rs0 --dbpath ./data        # one-time in another terminal:
  mongosh --eval "rs.initiate()"              # only needed the first time
  ```
  then set `MONGODB_URI=mongodb://127.0.0.1:27017/smm-panel?replicaSet=rs0`.
- **Standalone also works:** the connection layer auto-detects non-replicated
  URIs and sends `retryWrites: false`; every credit operation runs through
  `runInTransaction()` (`src/db/transactions.ts`), which executes without a
  session on such deployments (single-document writes stay atomic; a warning is
  logged once). Use a real replica set or Atlas in production.

Useful scripts:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
```

### Cron setup (publishes due posts)

The scheduler is triggered by hitting the worker endpoint every minute:

```bash
* * * * * curl -s -X POST https://your-panel.com/api/posts/process \
             -H "x-cron-secret: $CRON_SECRET"
```

On Vercel, add a `vercel.json` cron entry instead. Admin sessions may also call it manually.

---

## 4. API reference & example payloads

All responses use the shared envelope `{ "success": boolean, "data": ..., "message": string }`.
Errors return proper HTTP codes: `400` bad request · `401` unauthenticated ·
`403` forbidden/CSRF · `404` not found · `409` conflict · `422` validation ·
`429` rate limited · `502` provider failure · `503` not configured.

### Authentication

- **Browser**: httpOnly cookie `smm_token` (set by `/api/auth/login`) + `x-csrf-token`
  header echoing the `csrf_token` cookie on mutations (handled by `apiFetch`).
- **API clients (Postman / Thunder Client)**: send
  `Authorization: Bearer <jwt>` — obtain a token by logging in via `/api/auth/login`
  and reading the `Set-Cookie: smm_token=…` value, or mint one server-side with
  `signToken()` from `src/lib/auth.ts`.

---

### 4.1 Manage multiple accounts — `/api/accounts/manage`

**Connect** `POST /api/accounts/manage`

```json
{
  "platform": "instagram",
  "handle": "@yourbrand",
  "externalId": "17841400000000000",
  "accessToken": "EAAG…optional-oauth-token",
  "tokenExpiresAt": "2026-12-31T00:00:00.000Z",
  "meta": { "profileUrl": "https://instagram.com/yourbrand" }
}
```

Response `201`:

```json
{
  "success": true,
  "message": "Account connected",
  "data": {
    "id": "66f1c2…", "platform": "instagram", "handle": "@yourbrand",
    "status": "active", "hasAccessToken": true,
    "tokenExpiresAt": "2026-12-31T00:00:00.000Z",
    "externalId": "17841400000000000",
    "meta": { "profileUrl": "https://instagram.com/yourbrand" },
    "createdAt": "2026-08-23T17:20:11.123Z"
  }
}
```

> Tokens are encrypted with AES-256-GCM before storage and are **never**
> returned by any endpoint — only the boolean `hasAccessToken`.

**List** `GET /api/accounts/manage` → `{ data: { accounts: [ …same shape… ] } }`

**Update** `PATCH /api/accounts/manage`

```json
{ "id": "66f1c2…", "status": "paused" }
```

**Disconnect** `DELETE /api/accounts/manage?id=66f1c2…`

---

### 4.2 Schedule a post — `/api/posts/schedule`

**Schedule** `POST /api/posts/schedule`

```json
{
  "accountId": "66f1c2…",
  "content": "New reel dropping tonight 🎬 #launchday",
  "mediaUrls": ["https://cdn.example.com/reel.mp4"],
  "scheduledAt": "2026-08-24T18:30:00.000Z",
  "boost": {
    "serviceId": 123,
    "link": "https://instagram.com/reel/abc",
    "quantity": 1000,
    "runs": 5,
    "interval": 60
  }
}
```

Response `201`:

```json
{
  "success": true,
  "message": "Post scheduled",
  "data": {
    "id": "66f9a1…", "accountId": "66f1c2…", "accountHandle": "@yourbrand",
    "platform": "instagram", "status": "scheduled",
    "scheduledAt": "2026-08-24T18:30:00.000Z",
    "boost": { "serviceId": 123, "quantity": 1000, "runs": 5, "interval": 60 },
    "smmOrderId": null, "lastError": null
  }
}
```

Add `"executeNow": true` to place the boost order immediately ("Post now") —
the response then contains the provider order id and message
`"Post published — boost order placed"`.

Drip-feed rules mirror the provider: `runs` and `interval` must be supplied
together; `interval` is minutes between runs (5–1440).

**List** `GET /api/posts/schedule?page=1&limit=10&status=scheduled`

**Cancel** `DELETE /api/posts/schedule?id=66f9a1…` — only while still `scheduled`.

**Publish due posts** `POST /api/posts/process?limit=25`
(header `x-cron-secret: $CRON_SECRET` or admin session)

```json
{
  "success": true,
  "message": "Processed 3 due post(s)",
  "data": { "due": 3, "placed": 2, "completed": 1, "failed": 0, "skipped": 0 }
}
```

Each post is claimed atomically (`scheduled → processing`) so overlapping cron
runs can never double-order. Failures are stored on the post as a sanitized
`lastError` and surfaced in the UI.

---

### 4.3 Fetch analytics — `/api/analytics/fetch`

**Query** `GET /api/analytics/fetch?days=30&postId=66f9a1…`

```json
{
  "success": true,
  "message": "Analytics loaded",
  "data": {
    "window": { "days": 30, "since": "2026-07-24T…", "until": "2026-08-23T…" },
    "summary": { "likes": 1240, "comments": 96, "reach": 18400, "impressions": 21050, "shares": 41, "snapshots": 28 },
    "series": [
      { "date": "2026-08-22", "likes": 120, "comments": 9, "reach": 1800, "impressions": 2050 }
    ],
    "accounts": [
      { "accountId": "66f1c2…", "handle": "@yourbrand", "platform": "instagram",
        "latest": { "likes": 320, "comments": 24, "reach": 5200, "followers": 8421, "capturedAt": "…" } }
    ],
    "post": {
      "id": "66f9a1…", "platform": "instagram", "status": "processing",
      "smmOrderId": 90210,
      "live": { "providerStatus": "In progress", "startCount": 512, "remains": 400,
                "quantity": 1000, "delivered": 600, "charge": 1.2, "currency": "USD" }
    }
  }
}
```

`post.live` comes from the provider's `action=status` call (`delivered =
quantity − remains`). If the provider is unreachable, `live.error` is set and
everything else still renders.

**Ingest snapshot** `POST /api/analytics/fetch` (manual entry or platform webhook)

```json
{
  "accountId": "66f1c2…",
  "likes": 320,
  "comments": 24,
  "reach": 5200,
  "impressions": 6010,
  "followers": 8421,
  "source": "webhook"
}
```

Response `201`: `{ "data": { "id": "…", "capturedAt": "…", "source": "webhook" } }`.
Every referenced id is ownership-checked before insertion.

---

## 5. Testing with Postman / Thunder Client

1. Start the app (`npm run dev`) and register/login through the UI once so your
   user exists and is email-verified.
2. Grab a token: after login, copy the `smm_token` cookie value from DevTools →
   Application → Cookies (or decode it from the response of `/api/auth/login`).
3. In Postman create an environment with `baseUrl = http://localhost:3000` and
   `token = <smm_token value>`.
4. On each request set headers:
   - `Authorization: Bearer {{token}}`
   - `Content-Type: application/json`
   - For mutations also send `x-csrf-token: <value of csrf_token cookie>`
     (fetch any GET first so the proxy sets the cookie), **or** simply include
     an `Origin: http://localhost:3000` header — either satisfies the CSRF check.
5. Walk the happy path:
   1. `POST /api/accounts/manage` → connect `@yourbrand`
   2. `POST /api/posts/schedule` → schedule with a boost 2 minutes out
   3. Wait / `POST /api/posts/process` with `x-cron-secret`
   4. `GET /api/analytics/fetch?days=7` → see summary + live boost status
   5. `POST /api/analytics/fetch` → ingest a manual snapshot, re-fetch

Negative tests worth running: expired/missing token → `401`; body missing
`accountId` → `422`; second identical account connection → `409`; 11 schedule
calls within a minute → `429`; mutation without Origin/CSRF header → `403`.

## 6. Security notes

- Passwords: bcryptjs @ 12 salt rounds (`src/lib/auth.ts`).
- Sessions: HS256 JWT via `jose`, ≥32-char secret from env, httpOnly/SameSite cookie.
- CSRF: double-submit cookie **and** same-origin check in `src/proxy.ts`.
- Rate limiting: MongoDB-backed buckets per user/IP per rule.
- Input validation: zod schemas + HTML-tag stripping sanitizers everywhere.
- SSRF guards: private/internal hosts rejected for all user-supplied URLs.
- Secrets: env-only, never logged; provider errors are mapped to key-free messages.
- Token storage: AES-256-GCM authenticated encryption (`src/lib/crypto.ts`).

---

## 7. Credit system & pricing (Razorpay → credits → marked-up orders)

### 7.1 Lifecycle

```
Razorpay Checkout (/add-funds)
   │  POST /api/payment/create-order        → razorpay order id
   │  Checkout.js popup → user pays
   ▼
POST /api/payment/webhook   (payment.captured, HMAC-verified)
   │  atomic $inc of user.creditBalance + Transaction(credit, success)
   ▼
User spends credits:
   POST /api/services/order
      ├─ price = qty/1000 × providerCostPer1000 × (1 + markupPercent/100)
      ├─ ATOMIC transaction: conditional balance deduction + Order + debit Transaction
      ├─ SMM provider action=add
      ├─ success → Order.processing (+ smmOrderId stored)
      └─ failure → compensating transaction REFUNDS credits automatically
```

### 7.2 Pricing rule

`src/lib/pricing.ts` is the single source of truth:

```
userCost = quantity / 1000 × providerCostPer1000 × (1 + markupPercent / 100)
```

Provider charges **100** → user is deducted **130** (default `markupPercent = 30`,
per-service override allowed, hard-capped at 500%). If a service has no
`providerCostPer1000`, the admin-set `pricePer1000` is used as the cost basis.
The same function prices the UI preview (via server-computed
`userPricePer1000` on service listings) and the actual deduction — they can
never diverge. Provider costs/markups are stripped from all public responses.

### 7.3 Service setup (admin)

Create services with the new pricing fields (stored in the `services` collection):

```json
{
  "categoryId": "66f…",
  "name": "Instagram Followers — Real",
  "pricePer1000": 149,
  "providerServiceId": 1234,
  "providerCostPer1000": 100,
  "markupPercent": 30,
  "minQuantity": 100,
  "maxQuantity": 100000,
  "status": "active"
}
```

`providerServiceId` is required for the automated `/api/services/order` flow;
services without it fall back to manual fulfilment through `/api/orders`.

### 7.4 Endpoints

**Balance** — `GET /api/credits/balance`

```json
{ "success": true, "message": "Balance loaded",
  "data": { "balance": 482.5, "currency": "INR", "updatedAt": "2026-08-23T…" } }
```

**Order with markup** — `POST /api/services/order`

```json
{ "serviceId": "66f9…", "link": "https://instagram.com/p/abc", "quantity": 1000 }
```

Response `201` (service costs 100/1k at the provider → 130 credits deducted):

```json
{ "success": true, "message": "Order placed successfully",
  "data": { "orderId": "670a…", "smmOrderId": 90210, "status": "processing",
            "chargedCredits": 130, "providerCostPer1000": 100,
            "markupPercent": 30, "balance": 352.5 } }
```

Failure paths: `402` insufficient balance · `409` no provider mapping ·
`503` provider unconfigured · `502` provider rejected → **credits refunded**
(response includes `{ orderId, refunded }`, order marked `failed`, refund
Transaction recorded).

**Payment creation** — `POST /api/payment/create-order`
(existing; returns `orderId`, `amount` in paise, `keyId`, `demoMode` for local
testing without live keys). **Webhook** — `POST /api/payment/webhook`
verifies the `x-razorpay-signature` HMAC against `RAZORPAY_WEBHOOK_SECRET`,
cross-checks the captured amount, then atomically credits the balance exactly
once (idempotent per transaction).

Configure the webhook in the Razorpay dashboard → event `payment.captured`,
URL `https://your-panel.com/api/payment/webhook`.

### 7.5 Frontend integration

- **Buying credits**: `/add-funds` page + `PaymentButton` component open
  Razorpay Checkout.js with the order from `/api/payment/create-order`.
- **Spending credits**: `src/components/smm/ServiceOrderForm.tsx` shows the
  balance, lists services with their marked-up `userPricePer1000`, previews
  the total, and calls `/api/services/order`; the auth context is refreshed
  afterwards so the header balance updates instantly.
- Both use `apiFetch` (CSRF header + cookie session); API clients can send
  `Authorization: Bearer <jwt>` instead.
