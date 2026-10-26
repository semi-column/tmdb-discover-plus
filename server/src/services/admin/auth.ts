import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { config } from '../../config.ts';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

export const ADMIN_COOKIE = 'tdp_admin';
export const ADMIN_COOKIE_PATH = '/api/admin';
const AUDIENCE = 'tdp-admin';

// ---------- Password hashing (scrypt, no extra dependency) ----------
// Format: scrypt:N:r:p:salt:hash (base64url). Uses ':' rather than '$' so it
// survives docker-compose / shell env interpolation without escaping.

const DEFAULT_N = 1 << 15;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LEN = 64;

const maxmem = (N: number, r: number) => 256 * N * r;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, {
    N: DEFAULT_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
    maxmem: maxmem(DEFAULT_N, DEFAULT_R),
  });
  return [
    'scrypt',
    DEFAULT_N,
    DEFAULT_R,
    DEFAULT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join(':');
}

export function parsePasswordHash(encoded: string) {
  const parts = encoded.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, hash] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every(Number.isInteger) || N < 1 << 14 || N > 1 << 20 || (N & (N - 1)) !== 0)
    return null;
  if (R < 1 || R > 32 || P < 1 || P > 16) return null;
  const saltBuf = Buffer.from(salt, 'base64url');
  const hashBuf = Buffer.from(hash, 'base64url');
  if (saltBuf.length < 16 || hashBuf.length < 32) return null;
  return { N, r: R, p: P, salt: saltBuf, hash: hashBuf };
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  const key = await scryptAsync(password, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: maxmem(parsed.N, parsed.r),
  });
  return timingSafeEqual(key, parsed.hash);
}

export function safeEqualStrings(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** ADMIN_PASSWORD_HASH takes precedence; otherwise compare against ADMIN_PASSWORD in constant time. */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (config.admin.passwordHash) return verifyPassword(password, config.admin.passwordHash);
  const expected = config.admin.password;
  return expected.length >= config.admin.minPasswordLength && safeEqualStrings(password, expected);
}

export function adminCredentialSource(): 'hash' | 'password' | 'none' {
  if (config.admin.passwordHash) return 'hash';
  if (config.admin.password.length >= config.admin.minPasswordLength) return 'password';
  return 'none';
}

/** Explains why the admin is off despite some ADMIN_* vars being set (logged once at startup). */
export function adminConfigProblem(): string | null {
  const { username, password, passwordHash, minPasswordLength, totpSecret } = config.admin;
  if (!username && !password && !passwordHash) return null;
  if (!username) return 'ADMIN_USERNAME is not set';
  if (passwordHash && !parsePasswordHash(passwordHash)) return 'ADMIN_PASSWORD_HASH is malformed';
  if (!passwordHash && password.length < minPasswordLength) {
    return `ADMIN_PASSWORD must be at least ${minPasswordLength} characters`;
  }
  if (totpSecret) {
    try {
      if (base32Decode(totpSecret).length < 10) return 'ADMIN_TOTP_SECRET is too short';
    } catch {
      return 'ADMIN_TOTP_SECRET is not valid base32';
    }
  }
  return null;
}

export function isAdminEnabled(): boolean {
  return config.admin.enabled && adminConfigProblem() === null;
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30s) ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function totpCode(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export function verifyTotp(secretBase32: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(now / 30_000);
  let ok = false;
  for (const drift of [-1, 0, 1]) {
    if (safeEqualStrings(totpCode(secret, counter + drift), code)) ok = true;
  }
  return ok;
}

export function generateTotpSecret(label = 'TMDB Discover+ Admin'): {
  secret: string;
  otpauthUrl: string;
} {
  const secret = base32Encode(randomBytes(20));
  const name = encodeURIComponent(label);
  return { secret, otpauthUrl: `otpauth://totp/${name}?secret=${secret}&issuer=${name}` };
}

// ---------- IP allow-list ----------

let allowList: BlockList | null | undefined;

export function isIpAllowed(ip: string): boolean {
  if (allowList === undefined) {
    const entries = config.admin.allowedIps;
    if (!entries.length) {
      allowList = null;
    } else {
      allowList = new BlockList();
      for (const entry of entries) {
        const [addr, prefix] = entry.split('/');
        const type = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
        if (!isIP(addr)) continue;
        if (prefix) allowList.addSubnet(addr, Number(prefix), type);
        else allowList.addAddress(addr, type);
      }
    }
  }
  if (!allowList) return true;
  const normalized = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const type = isIP(normalized) === 6 ? 'ipv6' : 'ipv4';
  return isIP(normalized) !== 0 && allowList.check(normalized, type);
}

// ---------- Session tokens ----------
// Deterministic across replicas, and changing the admin password invalidates every session.

function sessionKey(): string {
  const credential =
    config.admin.passwordHash || createHash('sha256').update(config.admin.password).digest('hex');
  return createHmac('sha256', config.jwt.secret)
    .update(`admin-session:${config.admin.username}:${credential}`)
    .digest('hex');
}

export function issueSession(): { token: string; jti: string; maxAgeSec: number } {
  const jti = randomBytes(16).toString('base64url');
  const maxAgeSec = config.admin.sessionHours * 3600;
  const token = jwt.sign({ sub: config.admin.username, jti }, sessionKey(), {
    algorithm: 'HS256',
    audience: AUDIENCE,
    expiresIn: maxAgeSec,
  });
  return { token, jti, maxAgeSec };
}

export function verifySession(token: string): { sub: string; jti: string; exp: number } | null {
  try {
    const payload = jwt.verify(token, sessionKey(), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    }) as jwt.JwtPayload;
    if (typeof payload.jti !== 'string' || typeof payload.sub !== 'string' || !payload.exp)
      return null;
    if (payload.sub !== config.admin.username) return null;
    return { sub: payload.sub, jti: payload.jti, exp: payload.exp };
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim() || null;
  }
  return null;
}

export function buildCookie(value: string, maxAgeSec: number, secure: boolean): string {
  return [
    `${ADMIN_COOKIE}=${value}`,
    `Path=${ADMIN_COOKIE_PATH}`,
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}
