/**
 * Domain errors thrown by the service layer.
 *
 * Services throw these for business-logic failures; transport layers
 * (routes, MCP tool handlers) catch and map them to the appropriate
 * protocol response. Each class carries a `status` code the route-level
 * error mapping uses for HTTP status; MCP handlers surface the message
 * directly.
 *
 * We keep these lightweight (no stack-trace hygiene, no i18n) because
 * the existing HTTP contract just returns `{ error: string }` bodies.
 */

export class ServiceError extends Error {
  status: number;
  /**
   * Optional extra payload fields that get merged into the HTTP error
   * response (e.g. `available_headings` on a 404 from findSection).
   */
  extra?: Record<string, unknown>;

  constructor(message: string, status: number, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.extra = extra;
  }
}

export class NotFoundError extends ServiceError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super(message, 404, extra);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super(message, 400, extra);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super(message, 409, extra);
    this.name = 'ConflictError';
  }
}

export class ServiceUnavailableError extends ServiceError {
  retryAfter?: number;
  constructor(message: string, retryAfter?: number) {
    super(message, 503);
    this.name = 'ServiceUnavailableError';
    this.retryAfter = retryAfter;
  }
}
