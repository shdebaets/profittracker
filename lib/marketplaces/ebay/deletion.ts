import { createHash } from "node:crypto"

/** eBay endpoint validation: sha256(challengeCode + verificationToken + endpoint), hex. */
export function challengeResponse(challengeCode: string, verificationToken: string, endpoint: string) {
  return createHash("sha256").update(challengeCode).update(verificationToken).update(endpoint).digest("hex")
}
