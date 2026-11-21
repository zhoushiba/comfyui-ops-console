/**
 * 密码散列：Node 内置 scrypt，避免引入 bcrypt 原生依赖。
 * 存储格式： scrypt$<saltHex>$<hashHex>
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  try {
    const expected = Buffer.from(hash!, 'hex');
    const actual = scryptSync(password, salt!, KEY_LENGTH);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
