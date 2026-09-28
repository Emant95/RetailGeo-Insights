import type { z } from 'zod';
import type { Deps, RequestContext, AuthUser } from '../context';
import type { Schemas } from '../schemas';
import type { PublicUser, RoleKey, User } from '../types';
import { AppError } from '../errors';
import { permissionsFor } from '../rbac';
import { randomDigits, randomToken, sha256, timingSafeEqual } from '../crypto';
import { nowIso, uuid, audit, requireUser } from '../util';

const ADMIN_ROLES: RoleKey[] = ['platform_admin', 'platform_support'];

export async function toPublicUser(deps: Deps, u: User): Promise<PublicUser> {
  const roles = await deps.db.userRoles.findMany({ userId: u.id });
  const staff = await deps.db.storeUsers.findMany({ userId: u.id });
  const { passwordHash, failedLogins, lockedUntil, deletedAt, ...rest } = u;
  void passwordHash; void failedLogins; void lockedUntil; void deletedAt;
  return {
    ...rest,
    roles: [...new Set(roles.map((r) => r.role))],
    businessIds: roles.filter((r) => r.businessId).map((r) => r.businessId!) ,
    storeIds: staff.map((s) => s.storeId),
  };
}

async function issueSession(deps: Deps, ctx: RequestContext, user: User) {
  const roles = [...new Set((await deps.db.userRoles.findMany({ userId: user.id })).map((r) => r.role))];
  const refreshToken = randomToken(32);
  const session = await deps.db.sessions.insert({
    id: uuid(),
    userId: user.id,
    tokenHash: await sha256(refreshToken),
    expiresAt: new Date(Date.now() + deps.config.refreshTtlDays * 86400_000).toISOString(),
    revokedAt: null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    createdAt: nowIso(),
  });
  const accessToken = await deps.jwt.sign({ sub: user.id, email: user.email, roles, sid: session.id });
  return {
    accessToken,
    refreshToken: `${session.id}.${refreshToken}`,
    expiresIn: deps.jwt.ttl,
    user: await toPublicUser(deps, user),
  };
}

export async function register(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.register>) {
  const existing = await deps.db.users.findOne({ email: input.email });
  if (existing) throw new AppError('CONFLICT', 'An account with this email already exists. Sign in instead.');
  const user: User = {
    id: uuid(),
    email: input.email,
    passwordHash: await deps.hasher.hash(input.password),
    fullName: input.fullName,
    phone: null,
    status: 'active',
    emailVerifiedAt: null,
    mfaEnabled: false,
    failedLogins: 0,
    lockedUntil: null,
    marketingConsent: input.marketingConsent,
    locationSharing: false,
    deletedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await deps.db.users.insert(user);
  await deps.db.userRoles.insert({ id: uuid(), userId: user.id, role: 'consumer', businessId: null, createdAt: nowIso() });
  await sendVerification(deps, user);
  await deps.events.publish('user.registered', { userId: user.id, email: user.email });
  return issueSession(deps, ctx, user);
}

async function createToken(deps: Deps, userId: string, purpose: 'verify_email' | 'reset_password' | 'mfa', raw: string, minutes: number) {
  const t = await deps.db.authTokens.insert({
    id: uuid(),
    userId,
    purpose,
    tokenHash: await sha256(raw),
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    consumedAt: null,
    attempts: 0,
    createdAt: nowIso(),
  });
  return t;
}

async function sendVerification(deps: Deps, user: User) {
  const raw = randomToken(24);
  const t = await createToken(deps, user.id, 'verify_email', raw, 60 * 24);
  await deps.email.send({
    to: user.email,
    kind: 'verify_email',
    subject: 'Confirm your RetailGeo email',
    body: `Confirm your email: ${deps.config.publicWebUrl}/#/verify?token=${t.id}.${raw}`,
  });
}

async function consumeToken(deps: Deps, token: string, purpose: 'verify_email' | 'reset_password') {
  const [id, raw] = token.split('.');
  const t = id ? await deps.db.authTokens.get(id) : null;
  if (!t || t.purpose !== purpose || t.consumedAt || new Date(t.expiresAt) < new Date() || !timingSafeEqual(t.tokenHash, await sha256(raw ?? ''))) {
    throw new AppError('VALIDATION_FAILED', 'This link is invalid or has expired. Request a new one.');
  }
  await deps.db.authTokens.update(t.id, { consumedAt: nowIso() });
  return t;
}

export async function login(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.login>) {
  const generic = new AppError('UNAUTHENTICATED', 'Email or password is incorrect.');
  const user = await deps.db.users.findOne({ email: input.email });
  if (!user || user.deletedAt) {
    await deps.hasher.hash(input.password); // equalize timing
    throw generic;
  }
  if (user.status === 'disabled') throw new AppError('FORBIDDEN', 'This account has been disabled. Contact support.');
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes or reset your password.');
  }
  const ok = await deps.hasher.verify(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    const lock = failed >= deps.config.maxFailedLogins;
    await deps.db.users.update(user.id, {
      failedLogins: lock ? 0 : failed,
      lockedUntil: lock ? new Date(Date.now() + deps.config.lockMinutes * 60_000).toISOString() : null,
    });
    if (lock) await audit(deps, { ...ctx, user: null }, 'auth.account_locked', 'user', user.id, null, { failed });
    throw generic;
  }
  await deps.db.users.update(user.id, { failedLogins: 0, lockedUntil: null });
  const roles = (await deps.db.userRoles.findMany({ userId: user.id })).map((r) => r.role);
  const needsMfa = deps.config.adminMfa && (user.mfaEnabled || roles.some((r) => ADMIN_ROLES.includes(r)));
  if (needsMfa) {
    const code = randomDigits(6);
    const challenge = await createToken(deps, user.id, 'mfa', code, 10);
    await deps.email.send({ to: user.email, kind: 'mfa', subject: 'Your RetailGeo sign-in code', body: `Your sign-in code is ${code}. It expires in 10 minutes.` });
    return { mfaRequired: true as const, challengeId: challenge.id };
  }
  await audit(deps, { ...ctx, user: { id: user.id, email: user.email } as AuthUser }, 'auth.login', 'user', user.id, null, null);
  return issueSession(deps, ctx, user);
}

export async function verifyMfa(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.mfa>) {
  const t = await deps.db.authTokens.get(input.challengeId);
  if (!t || t.purpose !== 'mfa' || t.consumedAt || new Date(t.expiresAt) < new Date() || t.attempts >= 5) {
    throw new AppError('UNAUTHENTICATED', 'This sign-in code has expired. Sign in again.');
  }
  if (!timingSafeEqual(t.tokenHash, await sha256(input.code))) {
    await deps.db.authTokens.update(t.id, { attempts: t.attempts + 1 });
    throw new AppError('UNAUTHENTICATED', 'That code is incorrect.');
  }
  await deps.db.authTokens.update(t.id, { consumedAt: nowIso() });
  const user = (await deps.db.users.get(t.userId))!;
  await audit(deps, { ...ctx, user: { id: user.id, email: user.email } as AuthUser }, 'auth.login_mfa', 'user', user.id, null, null);
  return issueSession(deps, ctx, user);
}

export async function refresh(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.refresh>) {
  const [sid, raw] = input.refreshToken.split('.');
  const s = sid ? await deps.db.sessions.get(sid) : null;
  const invalid = new AppError('UNAUTHENTICATED', 'Your session has ended. Sign in again.');
  if (!s || s.revokedAt || new Date(s.expiresAt) < new Date()) throw invalid;
  if (!timingSafeEqual(s.tokenHash, await sha256(raw ?? ''))) {
    // Possible token reuse: revoke the session family.
    await deps.db.sessions.update(s.id, { revokedAt: nowIso() });
    throw invalid;
  }
  await deps.db.sessions.update(s.id, { revokedAt: nowIso() }); // rotation
  const user = await deps.db.users.get(s.userId);
  if (!user || user.status === 'disabled' || user.deletedAt) throw invalid;
  return issueSession(deps, ctx, user);
}

export async function logout(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  await deps.db.sessions.update(u.sessionId, { revokedAt: nowIso() }).catch(() => undefined);
  return { ok: true };
}

export async function me(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  const user = await deps.db.users.get(u.id);
  if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  return toPublicUser(deps, user);
}

export async function verifyEmail(deps: Deps, _ctx: RequestContext, input: z.infer<typeof Schemas.token>) {
  const t = await consumeToken(deps, input.token, 'verify_email');
  await deps.db.users.update(t.userId, { emailVerifiedAt: nowIso(), status: 'active' });
  return { ok: true };
}

export async function resendVerification(deps: Deps, ctx: RequestContext) {
  const u = requireUser(ctx);
  const user = (await deps.db.users.get(u.id))!;
  if (!user.emailVerifiedAt) await sendVerification(deps, user);
  return { ok: true };
}

export async function forgotPassword(deps: Deps, _ctx: RequestContext, input: z.infer<typeof Schemas.forgot>) {
  const user = await deps.db.users.findOne({ email: input.email });
  if (user && !user.deletedAt) {
    const raw = randomToken(24);
    const t = await createToken(deps, user.id, 'reset_password', raw, 30);
    await deps.email.send({ to: user.email, kind: 'reset_password', subject: 'Reset your RetailGeo password', body: `Reset your password: ${deps.config.publicWebUrl}/#/reset?token=${t.id}.${raw}` });
  }
  // Same response either way to avoid account enumeration.
  return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
}

export async function resetPassword(deps: Deps, ctx: RequestContext, input: z.infer<typeof Schemas.reset>) {
  const t = await consumeToken(deps, input.token, 'reset_password');
  await deps.db.users.update(t.userId, { passwordHash: await deps.hasher.hash(input.password), failedLogins: 0, lockedUntil: null });
  for (const s of await deps.db.sessions.findMany({ userId: t.userId, revokedAt: null })) await deps.db.sessions.update(s.id, { revokedAt: nowIso() });
  await audit(deps, ctx, 'auth.password_reset', 'user', t.userId, null, null);
  return { ok: true };
}

/** Resolve a bearer token into an AuthUser (used by every transport). */
export async function authenticate(deps: Deps, bearer: string | null): Promise<AuthUser | null> {
  if (!bearer) return null;
  const claims = await deps.jwt.verify(bearer);
  if (!claims) return null;
  const session = await deps.db.sessions.get(claims.sid);
  if (!session || session.revokedAt) return null;
  const user = await deps.db.users.get(claims.sub);
  if (!user || user.status === 'disabled' || user.deletedAt) return null;
  const roles = [...new Set((await deps.db.userRoles.findMany({ userId: user.id })).map((r) => r.role))];
  return { id: user.id, email: user.email, roles, permissions: permissionsFor(roles), sessionId: session.id };
}
