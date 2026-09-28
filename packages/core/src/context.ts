import type { DataStore } from './db';
import type { EventBus } from './events';
import type { PasswordHasher, JwtService } from './crypto';
import type { PaymentProvider } from './providers/payments';
import type { GeocodingProvider } from './providers/geocoding';
import type { MessageChannel } from './providers/channels';
import type { RoleKey } from './types';
import type { Permission } from './rbac';

export interface Deps {
  db: DataStore;
  events: EventBus;
  hasher: PasswordHasher;
  jwt: JwtService;
  payments: PaymentProvider;
  geocoder: GeocodingProvider;
  email: MessageChannel;
  config: {
    env: 'development' | 'test' | 'production' | 'demo';
    refreshTtlDays: number;
    maxFailedLogins: number;
    lockMinutes: number;
    /** Admin MFA via one-time email code. */
    adminMfa: boolean;
    publicWebUrl: string;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  roles: RoleKey[];
  permissions: Set<Permission>;
  sessionId: string;
}

export interface RequestContext {
  user: AuthUser | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  idempotencyKey: string | null;
}
