/** Standard error envelope: { error: { code, message, details? } } with an HTTP status. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'PAYMENT_FAILED'
  | 'INSUFFICIENT_STOCK'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  ACCOUNT_LOCKED: 423,
  PAYMENT_FAILED: 402,
  INSUFFICIENT_STOCK: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} was not found.`);
export const forbidden = (msg = 'You do not have permission to do that.') => new AppError('FORBIDDEN', msg);
export const invalid = (msg: string, details?: unknown) => new AppError('VALIDATION_FAILED', msg, details);
export const badState = (msg: string) => new AppError('INVALID_STATE', msg);
