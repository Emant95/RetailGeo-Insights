import type { Deps, RequestContext } from './context';
import { AppError, forbidden } from './errors';
import type { Permission } from './rbac';
import type { EmployeeCapability, Store } from './types';

export const uuid = () => globalThis.crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function requireUser(ctx: RequestContext) {
  if (!ctx.user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  return ctx.user;
}

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export function orderNumber(prefix: string) {
  const t = Date.now().toString(36).toUpperCase().slice(-5);
  const r = Math.floor(Math.random() * 36 ** 3).toString(36).toUpperCase().padStart(3, '0');
  return `${prefix}-${t}${r}`;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(all: T[], page = 1, pageSize = 20): Page<T> {
  const size = Math.min(100, Math.max(1, pageSize));
  const p = Math.max(1, page);
  return {
    items: all.slice((p - 1) * size, p * size),
    page: p,
    pageSize: size,
    total: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
  };
}

/** Capability required for an employee to act; merchant admins of the owning business can do everything. */
export async function assertStoreAccess(deps: Deps, ctx: RequestContext, storeId: string, capability?: EmployeeCapability): Promise<Store> {
  const user = requireUser(ctx);
  const store = await deps.db.stores.get(storeId);
  if (!store || store.deletedAt) throw new AppError('NOT_FOUND', 'Store was not found.');
  if (user.permissions.has('admin.stores') && user.roles.includes('platform_admin')) return store;
  const ownerRole = await deps.db.userRoles.findOne({ userId: user.id, role: 'merchant_admin', businessId: store.businessId });
  if (ownerRole) return store;
  const staff = await deps.db.storeUsers.findOne({ userId: user.id, storeId });
  if (!staff) throw forbidden('You do not have access to this store.');
  if (staff.staffRole === 'manager') return store;
  if (capability && !staff.capabilities.includes(capability)) {
    throw forbidden('Your store role does not include this action. Ask the store owner to grant it.');
  }
  return store;
}

export async function accessibleStoreIds(deps: Deps, ctx: RequestContext): Promise<string[]> {
  const user = requireUser(ctx);
  const ids = new Set<string>();
  const owned = await deps.db.userRoles.findMany({ userId: user.id, role: 'merchant_admin' });
  for (const r of owned) {
    if (!r.businessId) continue;
    for (const s of await deps.db.stores.findMany({ businessId: r.businessId, deletedAt: null })) ids.add(s.id);
  }
  for (const su of await deps.db.storeUsers.findMany({ userId: user.id })) ids.add(su.storeId);
  return [...ids];
}

export async function audit(
  deps: Deps,
  ctx: RequestContext,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  await deps.db.auditLogs.insert({
    id: uuid(),
    actorId: ctx.user?.id ?? null,
    actorEmail: ctx.user?.email ?? null,
    action,
    entity,
    entityId,
    before: before ?? null,
    after: after ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    createdAt: nowIso(),
  });
}

export function requirePermission(ctx: RequestContext, p: Permission) {
  const u = requireUser(ctx);
  if (!u.permissions.has(p)) throw forbidden();
  return u;
}

/** Minimal diff for audit before/after payloads. */
export function diff<T extends Record<string, any>>(before: T, patch: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(patch[k])) {
      b[k] = before[k];
      a[k] = patch[k];
    }
  }
  return { before: b, after: a };
}
