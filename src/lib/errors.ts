export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  constructor(
    message: string,
    readonly existing?: unknown,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export function errorChain(error: unknown) {
  const parts: string[] = [];
  let current = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" ");
}

export function isUniqueConstraintError(error: unknown) {
  return /UNIQUE constraint failed|duplicate key value violates unique constraint/i.test(errorChain(error));
}

export function isForeignKeyError(error: unknown) {
  return /FOREIGN KEY constraint failed|violates foreign key constraint/i.test(errorChain(error));
}
