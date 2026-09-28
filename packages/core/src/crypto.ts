/**
 * Crypto helpers built on WebCrypto so they run identically in Node 20+ and browsers.
 * Passwords: PBKDF2-HMAC-SHA256 (OWASP-recommended; 600k iterations in production).
 * Access tokens: compact HS256 JWTs. Refresh/verification tokens: random, stored only as SHA-256 hashes.
 */
const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomDigits(n = 6): string {
  const v = globalThis.crypto.getRandomValues(new Uint32Array(n));
  return Array.from(v, (x) => String(x % 10)).join('');
}

export async function sha256(input: string): Promise<string> {
  const d = await subtle().digest('SHA-256', enc.encode(input));
  return b64url(new Uint8Array(d));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export class Pbkdf2Hasher implements PasswordHasher {
  constructor(private iterations = 600_000) {}
  private async derive(password: string, salt: Uint8Array, iterations: number) {
    const key = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations }, key, 256);
    return b64url(new Uint8Array(bits));
  }
  async hash(password: string) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2_sha256$${this.iterations}$${b64url(salt)}$${await this.derive(password, salt, this.iterations)}`;
  }
  async verify(password: string, stored: string) {
    const [alg, iter, salt, hash] = stored.split('$');
    if (alg !== 'pbkdf2_sha256' || !salt || !hash) return false;
    return timingSafeEqual(await this.derive(password, fromB64url(salt), Number(iter)), hash);
  }
}

export interface AccessClaims {
  sub: string;
  email: string;
  roles: string[];
  sid: string;
  iat: number;
  exp: number;
}

export class JwtService {
  private keyP: Promise<CryptoKey>;
  constructor(secret: string, private ttlSec = 900, private issuer = 'retailgeo') {
    this.keyP = subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }
  async sign(claims: Omit<AccessClaims, 'iat' | 'exp'>, now = Date.now()): Promise<string> {
    const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const iat = Math.floor(now / 1000);
    const body = b64url(enc.encode(JSON.stringify({ ...claims, iss: this.issuer, iat, exp: iat + this.ttlSec })));
    const sig = await subtle().sign('HMAC', await this.keyP, enc.encode(`${header}.${body}`));
    return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
  }
  async verify(token: string, now = Date.now()): Promise<AccessClaims | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const ok = await subtle().verify('HMAC', await this.keyP, fromB64url(parts[2]) as unknown as BufferSource, enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    try {
      const claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
      if (claims.iss !== this.issuer || typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
      return claims as AccessClaims;
    } catch {
      return null;
    }
  }
  get ttl() {
    return this.ttlSec;
  }
}
