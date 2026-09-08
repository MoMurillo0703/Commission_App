let failPoint: string | null = null;

export function setTransactionFailPoint(point: string | null) {
  failPoint = point;
}

export function failIfTestHook(point: string) {
  if (failPoint !== point) return;
  failPoint = null;
  throw new Error(`Forced transaction failure: ${point}`);
}
