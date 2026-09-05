import { afterSaveQueue } from "./compensationQueue";

export function allocationSavedMessage() {
  return "Allocation saved. Posted commissions keep their original payout snapshots.";
}

export function allocationSaveErrorMessage(body: { message?: string } | null | undefined) {
  return body?.message?.trim() || "Unable to save allocation.";
}

export function nextQueueItemNotice() {
  return "Previous Group + LOB saved. This item still needs its own 100% allocation.";
}

export function allocationStillQueuedMessage() {
  return "Allocation saved, but this Group + LOB still needs a covering 100% allocation. Review the dates and splits before continuing.";
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
      notice: null as string | null,
      queue: [] as T[],
      queueIndex: input.queueIndex,
      queueDone: false,
      queueOpen: true,
      refreshed: false,
      persistConfirmed: false,
      stillQueued: false,
      loadNext: false,
    };
  }
  const refreshed = await input.refresh();
  const remaining = refreshed.queue;
  if (!input.savedKey) {
    return {
      error: null as string | null,
      success: allocationSavedMessage(),
      notice: null as string | null,
      queue: remaining,
      queueIndex: input.queueIndex,
      queueDone: false,
      queueOpen: false,
      refreshed: true,
      persistConfirmed: true,
      stillQueued: false,
      loadNext: false,
    };
  }
  if (remaining.some((item) => item.key === input.savedKey)) {
    return {
      error: null as string | null,
      success: allocationStillQueuedMessage(),
      notice: null as string | null,
      queue: remaining,
      queueIndex: input.queueIndex,
      queueDone: false,
      queueOpen: true,
      refreshed: true,
      persistConfirmed: true,
      stillQueued: true,
      loadNext: false,
    };
  }
  const advanced = afterSaveQueue(remaining, Math.min(input.queueIndex, remaining.length), input.savedKey);
  return {
    error: null as string | null,
    success: advanced.done ? allocationSavedMessage() : null,
    notice: advanced.done ? null : nextQueueItemNotice(),
    queue: advanced.items,
    queueIndex: advanced.index,
    queueDone: advanced.done,
    queueOpen: !advanced.done,
    refreshed: true,
    persistConfirmed: true,
    stillQueued: false,
    loadNext: !advanced.done,
  };
}
