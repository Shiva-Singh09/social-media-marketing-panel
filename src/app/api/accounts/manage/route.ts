/**
 * /api/accounts/manage — multi-account management for connected socials.
 *
 *   GET    → list the caller's connected accounts (tokens NEVER returned;
 *            only a boolean `hasAccessToken` so the UI can show state)
 *   POST   → connect a new account (tokens encrypted with AES-256-GCM)
 *   PATCH  → update handle/status/tokens of an owned account
 *   DELETE ?id=… → disconnect (hard delete) an owned account
 *
 * All handlers are JWT-authenticated, rate limited per user, and validated
 * with zod. Duplicate connections (same user + platform + handle) are
 * rejected to keep analytics attribution unambiguous.
 */

import { SocialAccount } from "@/db";
import { encryptSecret } from "@/lib/crypto";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import {
  accountConnectSchema,
  accountUpdateSchema,
  accountIdQuerySchema,
  firstError,
} from "@/lib/smm-validators";

export const dynamic = "force-dynamic";

/** Public shape — ciphertext fields are stripped, presence is signalled instead. */
function toPublicAccount(account: Record<string, unknown>) {
  return {
    id: account._id,
    platform: account.platform,
    handle: account.handle,
    externalId: account.externalId ?? null,
    status: account.status,
    tokenExpiresAt: account.tokenExpiresAt ?? null,
    hasAccessToken: Boolean(account.accessTokenEnc),
    meta: account.meta ?? null,
    createdAt: account.createdAt,
  };
}

/** GET /api/accounts/manage */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "accounts", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    const rows = await SocialAccount.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .lean();

    return ok(
      { accounts: rows.map((row) => toPublicAccount(row as unknown as Record<string, unknown>)) },
      "Accounts loaded",
    );
  });
}

/**
 * POST /api/accounts/manage
 * Body: { platform, handle, externalId?, accessToken?, refreshToken?, tokenExpiresAt?, meta? }
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "accounts", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON", 400);
    }

    const parsed = accountConnectSchema.safeParse(body);
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const input = parsed.data;

    // Reject duplicate connections so scheduled posts/analytics always map
    // to exactly one identity per (platform, handle).
    const duplicate = await SocialAccount.exists({
      userId: user._id,
      platform: input.platform,
      handle: input.handle,
    });
    if (duplicate) {
      return fail("This account is already connected", 409);
    }

    // Tokens are encrypted BEFORE they ever touch the database.
    const [account] = await SocialAccount.create([
      {
        userId: user._id,
        platform: input.platform,
        handle: input.handle,
        externalId: input.externalId ?? null,
        accessTokenEnc: input.accessToken ? encryptSecret(input.accessToken) : null,
        refreshTokenEnc: input.refreshToken ? encryptSecret(input.refreshToken) : null,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        status: "active",
        meta: input.meta ?? null,
      },
    ]);

    console.info("[accounts] connected", {
      userId: String(user._id),
      accountId: String(account._id),
      platform: input.platform,
    });

    return ok(toPublicAccount(account.toObject() as unknown as Record<string, unknown>), "Account connected", 201);
  });
}

/**
 * PATCH /api/accounts/manage
 * Body: { id, handle?, status?, accessToken?, refreshToken?, tokenExpiresAt?, meta? }
 */
export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "accounts", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("Request body must be valid JSON", 400);
    }

    const parsed = accountUpdateSchema.safeParse(body);
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { id, ...changes } = parsed.data;

    const update: Record<string, unknown> = {};
    if (changes.handle !== undefined) update.handle = changes.handle;
    if (changes.status !== undefined) update.status = changes.status;
    if (changes.tokenExpiresAt !== undefined) update.tokenExpiresAt = changes.tokenExpiresAt;
    if (changes.meta !== undefined) update.meta = changes.meta;
    // Re-encrypt rotated tokens; empty string clears them.
    if (changes.accessToken !== undefined) {
      update.accessTokenEnc = changes.accessToken ? encryptSecret(changes.accessToken) : null;
    }
    if (changes.refreshToken !== undefined) {
      update.refreshTokenEnc = changes.refreshToken ? encryptSecret(changes.refreshToken) : null;
    }

    if (Object.keys(update).length === 0) {
      return fail("No updatable fields provided", 422);
    }

    const updated = await SocialAccount.findOneAndUpdate(
      { _id: id, userId: user._id },
      { $set: update },
      { returnDocument: "after" },
    );
    if (!updated) return fail("Account not found", 404);

    return ok(
      toPublicAccount(updated.toObject() as unknown as Record<string, unknown>),
      "Account updated",
    );
  });
}

/** DELETE /api/accounts/manage?id=… — disconnect an owned account. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const limited = await limitOrFail(req, "accounts", `user-${user._id}`);
    if (limited) return fail(limited, 429);

    const id = new URL(req.url).searchParams.get("id");
    const parsed = accountIdQuerySchema.safeParse({ id });
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const removed = await SocialAccount.findOneAndDelete({
      _id: parsed.data.id,
      userId: user._id,
    });
    if (!removed) return fail("Account not found", 404);

    console.info("[accounts] disconnected", {
      userId: String(user._id),
      accountId: String(removed._id),
      platform: removed.platform,
    });

    return ok({ id: removed._id }, "Account disconnected");
  });
}