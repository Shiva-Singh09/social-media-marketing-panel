import { createHash } from "node:crypto";

/** Stores only a deterministic digest while the raw token remains in the email link. */
export function hashSecurityToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
