import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// network-tutor-server(백엔드)의 scrypt 해시 형식과 반드시 동일해야 한다:
// "scrypt$<saltHex>$<hashHex>" — 계정은 그쪽에서 생성되므로 여기서 검증만 한다.
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(plain, salt, expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// 존재하지 않는 계정으로 로그인 시도할 때도 동일한 시간이 걸리도록 하는 더미 해시(타이밍 공격 방지).
export const DUMMY_PASSWORD_HASH =
  "scrypt$" +
  "0".repeat(32) +
  "$" +
  "0".repeat(128);
