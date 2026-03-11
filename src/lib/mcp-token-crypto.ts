import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = env.MCP_TOKEN_SECRET;
  if (!secret) {
    throw new Error("MCP_TOKEN_SECRET is required for token encryption");
  }
  return Buffer.from(secret, "hex");
}

export function encryptToken(plaintext: string): { encrypted: string; iv: string } {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decryptToken(encrypted: string, iv: string): string {
  const key = getKey();
  const buf = Buffer.from(encrypted, "hex");
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(0, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"), { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}
