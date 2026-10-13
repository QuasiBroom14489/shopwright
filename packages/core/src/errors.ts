export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** The request is valid but clashes with what exists, e.g. a duplicate shop slug. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** A capability this deployment doesn't have configured, e.g. an API key. */
export class UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnavailableError';
  }
}
