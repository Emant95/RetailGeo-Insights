import type { OrderStatus, StoreOrderStatus, FulfillmentType } from './types';
import { badState } from './errors';

/**
 * Consumer order lifecycle.
 * Cart → validation → payment → confirmed → processing → ready | out_for_delivery → completed
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['confirmed', 'payment_failed', 'cancelled'],
  payment_failed: ['pending_payment', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['ready', 'out_for_delivery', 'cancelled'],
  ready: ['completed', 'cancelled'],
  out_for_delivery: ['completed'],
  completed: [],
  cancelled: [],
};

export function nextOrderStatuses(status: OrderStatus, fulfillment: FulfillmentType): OrderStatus[] {
  return ORDER_TRANSITIONS[status].filter((s) =>
    fulfillment === 'delivery' ? s !== 'ready' : s !== 'out_for_delivery',
  );
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus, fulfillment: FulfillmentType) {
  if (!nextOrderStatuses(from, fulfillment).includes(to)) {
    throw badState(`An order that is ${label(from)} cannot move to ${label(to)}.`);
  }
}

/**
 * Store-to-store (B2B) lifecycle — a distinct workflow from consumer orders.
 * Draft → Submitted → Pending acceptance → Accepted → Preparing → Ready/Fulfilled → Completed
 * plus rejection, cancellation, partial fulfilment and quantity adjustment.
 */
export const STORE_ORDER_TRANSITIONS: Record<StoreOrderStatus, StoreOrderStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['pending_acceptance', 'cancelled'],
  pending_acceptance: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

/** Which party may perform each transition. */
export const STORE_ORDER_ACTOR: Partial<Record<StoreOrderStatus, 'buyer' | 'seller' | 'either'>> = {
  submitted: 'buyer',
  pending_acceptance: 'buyer', // automatic after submit
  accepted: 'seller',
  rejected: 'seller',
  preparing: 'seller',
  ready: 'seller',
  completed: 'buyer', // buyer confirms receipt
  cancelled: 'either',
};

export function assertStoreOrderTransition(from: StoreOrderStatus, to: StoreOrderStatus, actor: 'buyer' | 'seller') {
  if (!STORE_ORDER_TRANSITIONS[from].includes(to)) {
    throw badState(`A request that is ${label(from)} cannot move to ${label(to)}.`);
  }
  const who = STORE_ORDER_ACTOR[to];
  if (who && who !== 'either' && who !== actor) {
    throw badState(`Only the ${who === 'buyer' ? 'requesting' : 'supplying'} store can mark this ${label(to)}.`);
  }
  // Cancellation after acceptance is only allowed for the buyer before preparation starts, or the seller any time before ready.
  if (to === 'cancelled' && actor === 'buyer' && (from === 'preparing')) {
    throw badState('The supplying store has started preparing this request. Ask them to cancel it.');
  }
}

export function label(status: string): string {
  return status.replace(/_/g, ' ');
}
