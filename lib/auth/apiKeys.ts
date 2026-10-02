import { createHash, randomBytes } from "crypto";

export const API_KEY_PREFIX = "tms_";

export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), keyHash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
