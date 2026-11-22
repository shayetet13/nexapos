/** Standardized error codes */
export const ErrorCodes = {
  // Auth
  UNAUTHORIZED:       'AUTH_001',
  TOKEN_EXPIRED:      'AUTH_002',
  FORBIDDEN:          'AUTH_003',
  // Validation
  VALIDATION_ERROR:   'VAL_001',
  // Resource
  NOT_FOUND:          'RES_001',
  ALREADY_EXISTS:     'RES_002',
  CONFLICT:           'RES_003',
  // Business Logic
  INSUFFICIENT_STOCK: 'BIZ_001',
  PRODUCT_NOT_FOUND:  'BIZ_002',
  CREATE_FAILED:      'BIZ_003',
  // System
  INTERNAL_ERROR:     'SYS_001',
  DATABASE_ERROR:     'SYS_002',
  RATE_LIMIT:         'SYS_003',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Base application error — caught by the global error handler */
export class AppError extends Error {
  constructor(
    public override message: string,
    public statusCode: number,
    public code: ErrorCode | string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(msg = 'Unauthorized') {
    super(msg, 401, ErrorCodes.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(msg = 'Forbidden') {
    super(msg, 403, ErrorCodes.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, ErrorCodes.NOT_FOUND);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, msg = 'Validation failed') {
    super(msg, 400, ErrorCodes.VALIDATION_ERROR, details);
  }
}

export class ConflictError extends AppError {
  constructor(msg: string) {
    super(msg, 409, ErrorCodes.CONFLICT);
  }
}

export class InternalError extends AppError {
  constructor(msg = 'Internal server error') {
    super(msg, 500, ErrorCodes.INTERNAL_ERROR);
  }
}
