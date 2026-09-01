import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

function getKey(): Buffer {
  const key = Buffer.from(config.encryptionKey, "hex");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes (64 hex chars)");
  return key;
}

/** 학생이 등록한 OpenAI API 키처럼 민감한 값을 저장 전에 암호화한다(AES-256-GCM). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(".");
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return plain.toString("utf8");
}
