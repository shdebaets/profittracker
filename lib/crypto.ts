import "server-only"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

// AES-256-GCM for marketplace OAuth tokens at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url).

function key(secret = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is not set")
  // Accept any string; hash to exactly 32 bytes.
  return createHash("sha256").update(secret).digest()
}

export function encrypt(plain: string, secret?: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".")
}

export function decrypt(token: string, secret?: string): string {
  const [v, iv, tag, data] = token.split(".")
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Malformed encrypted value")
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}
