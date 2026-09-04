export const DATABASE_LIVENESS_TIMEOUT_MS = 5_000;
export const DATABASE_LIVENESS_TIMEOUT = "DATABASE_LIVENESS_TIMEOUT";
export const DATABASE_UNAVAILABLE_MESSAGE = "The database is temporarily unavailable. Try again.";

export async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  promise.catch(() => undefined);
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function ensureLiveClient<T>(options: {
  getCurrent: () => T | undefined;
  setCurrent: (client: T | undefined) => void;
  create: () => T;
  ping: (client: T) => Promise<void>;
  dispose: (client: T) => Promise<void>;
  pingTimeoutMs?: number;
}): Promise<T> {
  const timeoutMs = options.pingTimeoutMs ?? DATABASE_LIVENESS_TIMEOUT_MS;
  let current = options.getCurrent();
  if (!current) {
    current = options.create();
    options.setCurrent(current);
  }

  try {
    await withDeadline(options.ping(current), timeoutMs, DATABASE_LIVENESS_TIMEOUT);
    return current;
  } catch {
    const stale = current;
    options.setCurrent(undefined);
    await options.dispose(stale).catch(() => undefined);
    const fresh = options.create();
    options.setCurrent(fresh);
    try {
      await withDeadline(options.ping(fresh), timeoutMs, DATABASE_LIVENESS_TIMEOUT);
      return fresh;
    } catch {
      await options.dispose(fresh).catch(() => undefined);
      options.setCurrent(undefined);
      throw new Error(DATABASE_UNAVAILABLE_MESSAGE);
    }
  }
}
