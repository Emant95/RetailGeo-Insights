/**
 * Domain events. Every event carries a schema version so Phase 2 AI/ML consumers and a
 * future message bus (SNS/SQS, EventBridge, Kafka) can evolve independently.
 * Handlers run in-process after the originating write; production can swap
 * `InProcessEventBus` for an outbox-backed bus without changing publishers.
 */
export interface DomainEventMap {
  'user.registered': { userId: string; email: string };
  'order.placed': { orderId: string; userId: string; storeId: string; totalCents: number };
  'order.status_changed': { orderId: string; userId: string; storeId: string; from: string; to: string };
  'payment.captured': { orderId: string; userId: string; amountCents: number };
  'payment.failed': { orderId: string; userId: string; message: string };
  'payment.refunded': { orderId: string; userId: string; amountCents: number };
  'store_order.submitted': { storeOrderId: string; buyerStoreId: string; sellerStoreId: string };
  'store_order.status_changed': { storeOrderId: string; buyerStoreId: string; sellerStoreId: string; from: string; to: string };
  'inventory.low_stock': { storeId: string; storeProductId: string; productName: string; quantity: number };
  'inventory.changed': { storeId: string; storeProductId: string; delta: number; quantityAfter: number; source: string };
  'business.reviewed': { businessId: string; ownerUserId: string; status: string; notes: string | null };
  'store.status_changed': { storeId: string; status: string };
  'offer.published': { offerId: string; storeId: string };
  'product.upserted': { productId: string };
  'search.performed': { userId: string | null; query: string; resultCount: number };
}
export type DomainEventName = keyof DomainEventMap;

export const EVENT_SCHEMA_VERSION: Record<DomainEventName, number> = {
  'user.registered': 1, 'order.placed': 1, 'order.status_changed': 1, 'payment.captured': 1,
  'payment.failed': 1, 'payment.refunded': 1, 'store_order.submitted': 1, 'store_order.status_changed': 1,
  'inventory.low_stock': 1, 'inventory.changed': 1, 'business.reviewed': 1, 'store.status_changed': 1,
  'offer.published': 1, 'product.upserted': 1, 'search.performed': 1,
};

export type Handler<K extends DomainEventName> = (payload: DomainEventMap[K], meta: { name: K; version: number; at: string }) => Promise<void> | void;

export interface EventBus {
  publish<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): Promise<void>;
  subscribe<K extends DomainEventName>(name: K, handler: Handler<K>): void;
}

export class InProcessEventBus implements EventBus {
  private handlers = new Map<string, Handler<any>[]>();
  constructor(private onError: (e: unknown, name: string) => void = (e) => console.error(e)) {}
  subscribe<K extends DomainEventName>(name: K, handler: Handler<K>) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }
  async publish<K extends DomainEventName>(name: K, payload: DomainEventMap[K]) {
    const meta = { name, version: EVENT_SCHEMA_VERSION[name], at: new Date().toISOString() };
    for (const h of this.handlers.get(name) ?? []) {
      try {
        await h(payload, meta);
      } catch (e) {
        this.onError(e, name);
      }
    }
  }
}
