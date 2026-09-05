import { afterSaveQueue } from "./compensationQueue";

export function allocationSavedMessage() {
  return "Allocation saved. Posted commissions keep their original payout snapshots.";
}

export function allocationSaveErrorMessage(body: { message?: string } | null | undefined) {
  return body?.message?.trim() || "Unable to save allocation.";
}

export async function runAllocationSaveFlow<T extends { key: string }>(input: {
  request: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<{ queue: T[] }>;
  savedKey?: string | null;
  queueIndex: number;
}) {
  const response = await input.request();
  if (!response.ok) {
    return {
      error: allocationSaveErrorMessage(response),
      success: null as string | null,
      queue: [] as T[],
      queueIndex: input.queueIndex,
      queueDone: false,
      queueOpen: true,
      refreshed: false,
    };
  }
  const refreshed = await input.refresh();
  const remaining = refreshed.queue;
  if (input.savedKey) {
    const advanced = afterSaveQueue(remaining, Math.min(input.queueIndex, remaining.length), input.savedKey);
    return {
      error: null as string | null,
      success: allocationSavedMessage(),
      queue: remaining,
      queueIndex: advanced.index,
      queueDone: advanced.done,
      queueOpen: !advanced.done,
      refreshed: true,
    };
  }
  return {
    error: null as string | null,
    success: allocationSavedMessage(),
    queue: remaining,
    queueIndex: input.queueIndex,
    queueDone: false,
    queueOpen: false,
    refreshed: true,
  };
}
