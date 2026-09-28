import type { RoleKey } from './types';

/**
 * Role-based access control. Permissions are enforced by the API router on every route
 * (never only by frontend routes). Store-level scoping is enforced in services via
 * `assertStoreAccess`, which also honours per-employee capabilities.
 */
export const PERMISSIONS = [
  // consumer
  'cart.manage', 'orders.own', 'favorites.manage', 'profile.manage', 'notifications.own',
  // merchant
  'merchant.access', 'business.manage', 'stores.manage', 'staff.manage', 'products.manage',
  'inventory.manage', 'offers.manage', 'orders.view', 'orders.process', 'store_orders.manage', 'analytics.view',
  // platform
  'admin.access', 'admin.merchants', 'admin.stores', 'admin.users', 'admin.catalog', 'admin.moderation',
  'admin.orders', 'admin.disputes', 'admin.markets', 'admin.reports', 'admin.support',
  'admin.settings', 'admin.audit', 'admin.roles', 'admin.payments', 'admin.notifications',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CONSUMER: Permission[] = ['cart.manage', 'orders.own', 'favorites.manage', 'profile.manage', 'notifications.own'];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  consumer: CONSUMER,
  merchant_admin: [
    ...CONSUMER,
    'merchant.access', 'business.manage', 'stores.manage', 'staff.manage', 'products.manage', 'inventory.manage',
    'offers.manage', 'orders.view', 'orders.process', 'store_orders.manage', 'analytics.view',
  ],
  // Employees get merchant.access only; what they can do is decided per store by their capabilities.
  store_employee: [...CONSUMER, 'merchant.access'],
  platform_admin: [
    ...CONSUMER,
    'admin.access', 'admin.merchants', 'admin.stores', 'admin.users', 'admin.catalog', 'admin.moderation',
    'admin.orders', 'admin.disputes', 'admin.markets', 'admin.reports', 'admin.support', 'admin.settings',
    'admin.audit', 'admin.roles', 'admin.payments', 'admin.notifications',
  ],
  // Operations/support: onboarding, verification, moderation, order issues and disputes.
  // Deliberately no settings, roles, audit, payments/refunds or user-account control.
  platform_support: [
    ...CONSUMER,
    'admin.access', 'admin.merchants', 'admin.stores', 'admin.moderation', 'admin.orders', 'admin.disputes', 'admin.support',
  ],
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  consumer: 'Consumer',
  merchant_admin: 'Merchant administrator',
  store_employee: 'Store employee',
  platform_admin: 'Platform administrator',
  platform_support: 'Operations & support',
};

export function permissionsFor(roles: RoleKey[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return out;
}

export function can(roles: RoleKey[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}
