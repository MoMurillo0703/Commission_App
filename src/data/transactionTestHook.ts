let failPoint: string | null = null;
let afterAllocationNamespaceLock: ((db: unknown) => Promise<void>) | null = null;

export function setTransactionFailPoint(point: string | null) {
  failPoint = point;
}

export function setAfterAllocationNamespaceLock(hook: ((db: unknown) => Promise<void>) | null) {
  afterAllocationNamespaceLock = hook;
}

export function failIfTestHook(point: string) {
  if (failPoint !== point) return;
  failPoint = null;
  throw new Error(`Forced transaction failure: ${point}`);
}

export async function runAfterAllocationNamespaceLock(db: unknown) {
  if (!afterAllocationNamespaceLock) return;
  const hook = afterAllocationNamespaceLock;
  afterAllocationNamespaceLock = null;
  await hook(db);
}
