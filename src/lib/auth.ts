import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { User as UserModel, type IUser } from "@/db/mongodb-schema";
import { assertJwtSecretConfigured } from "@/lib/env";
import { getMaintenanceFlag } from "@/lib/settings";

export const SESSION_COOKIE = "smm_token";
const SALT_ROUNDS = 12;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * There is intentionally NO hardcoded fallback secret. A JWT signed with a
 * publicly-known string is trivially forgeable — an attacker could mint
 * their own "admin" session. If neither JWT_SECRET nor NEXTAUTH_SECRET is
 * configured we fail loudly instead of silently downgrading security.
 * In production a cryptographically strong random value is additionally
 * required (see assertJwtSecretConfigured — never logs the secret itself).
 */
function secretKey(): Uint8Array {
  assertJwtSecretConfigured();
  const secret = (process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET) as string;
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  sub: string;
  email: string;
  role: "user" | "admin";
  /**
   * Session version stamped at issue time. Compared against
   * `user.sessionVersion ?? 0` in getCurrentUser(). Tokens issued before a
   * sessionVersion bump (password reset / password change) are rejected.
   * Optional so pre-hardening tokens (no `sv` claim) keep working until the
   * next security change — treated as version 0.
   */
  sv?: number;
};

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hashed: string | null) {
  if (!hashed) return false;
  return bcrypt.compare(plain, hashed);
}

export async function signToken(payload: SessionPayload) {
  return new SignJWT({ email: payload.email, role: payload.role, sv: payload.sv ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    const sv = payload.sv;
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      role: (payload.role === "admin" ? "admin" : "user") as "user" | "admin",
      // Pre-hardening tokens carry no `sv` claim — normalize to 0 so they
      // match legacy users (sessionVersion ?? 0) instead of failing open.
      sv: typeof sv === "number" && Number.isFinite(sv) ? sv : 0,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Reads the JWT from the Authorization header (API clients) or the session cookie (browser). */
export async function getTokenFromRequest(req?: Request): Promise<string | null> {
  const header = req?.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export type SafeUser = Omit<
  IUser,
  "password" | "verificationToken" | "resetPasswordToken" | "resetPasswordExpires"
>;

export function toSafeUser(user: IUser): SafeUser {
  const {
    password: _password,
    verificationToken: _verificationToken,
    resetPasswordToken: _resetPasswordToken,
    resetPasswordExpires: _resetPasswordExpires,
    failedLoginAttempts: _failedLoginAttempts,
    loginLockUntil: _loginLockUntil,
    ...safe
  } = user.toObject?.() || user;
  return safe;
}

export async function getCurrentUser(req?: Request): Promise<IUser | null> {
  const token = await getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  const user = await UserModel.findOne({ email: payload.email });
  if (!user || user.status === "blocked") return null;
  // Session-version check: after a password reset / password change the
  // stored version is bumped and older tokens (lower `sv`) stop validating.
  // Legacy users and pre-hardening tokens both normalize to 0, so existing
  // sessions keep working until the next security change.
  if ((payload.sv ?? 0) !== (user.sessionVersion ?? 0)) return null;
  return user;
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(req?: Request): Promise<IUser> {
  const user = await getCurrentUser(req);
  if (!user) throw new HttpError("Unauthorized - please sign in", 401);

  // Maintenance mode blocks regular customers from the panel API while
  // admins keep full access to manage the site and turn it back off. This
  // reads a tiny, separately-cached boolean (not the full settings row) to
  // keep the hot path cheap.
  if (user.role !== "admin") {
    const maintenanceMode = await getMaintenanceFlag();
    if (maintenanceMode) {
      throw new HttpError(
        "The panel is temporarily down for maintenance. Please check back shortly.",
        503,
      );
    }
  }

  // Email verification is required for every authenticated action except
  // the handful of routes that intentionally call `getCurrentUser` directly
  // (session check, resend-verification). Google OAuth accounts are marked
  // verified automatically, so this only affects email/password sign-ups
  // that haven't confirmed their inbox yet — closing the "throwaway email +
  // spam orders" fraud path called out in the audit.
  if (user.role !== "admin" && !user.emailVerified) {
    throw new HttpError(
      "Please verify your email address before continuing. Check your inbox or resend the verification email from your profile.",
      403,
    );
  }

  return user;
}

export async function requireAdmin(req?: Request): Promise<IUser> {
  const user = await requireUser(req);
  if (user.role !== "admin") throw new HttpError("Forbidden - admin access required", 403);
  return user;
}
