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

export function isAllocationOverlapMessage(message: string | null | undefined) {
  return /already exists for this group, line, and period/i.test(message ?? "");
}

export function allocationRecoveredMessage() {
  return "This Group + LOB already has a covering 100% allocation. Continuing with the next item.";
}

export async function runAllocationSaveFlow<T extends { key: string }>(input: {
  request: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<{ queue: T[] }>;
  savedKey?: string | null;
  queueIndex: number;
}) {
  const failed = (error: string, extras: { refreshed?: boolean; persistConfirmed?: boolean; queue?: T[] } = {}) => ({
    error,
    success: null as string | null,
    notice: null as string | null,
    queue: extras.queue ?? [] as T[],
    queueIndex: input.queueIndex,
    queueDone: false,
    queueOpen: true,
    refreshed: extras.refreshed ?? false,
    persistConfirmed: extras.persistConfirmed ?? false,
    stillQueued: false,
    loadNext: false,
    recovered: false,
  });

  const coveredAdvance = (remaining: T[], recovered: boolean) => {
    const advanced = afterSaveQueue(remaining, Math.min(input.queueIndex, remaining.length), input.savedKey ?? "");
    return {
      error: null as string | null,
      success: advanced.done ? (recovered ? allocationRecoveredMessage() : allocationSavedMessage()) : null,
      notice: advanced.done ? null : (recovered ? allocationRecoveredMessage() : nextQueueItemNotice()),
      queue: advanced.items,
      queueIndex: advanced.index,
      queueDone: advanced.done,
      queueOpen: !advanced.done,
      refreshed: true,
      persistConfirmed: true,
      stillQueued: false,
      loadNext: !advanced.done,
      recovered,
    };
  };

  async function reconcileAfterAmbiguousSave() {
    if (!input.savedKey) return null;
    const refreshed = await input.refresh();
    if (refreshed.queue.some((item) => item.key === input.savedKey)) return { remaining: refreshed.queue, covered: false };
    return { remaining: refreshed.queue, covered: true };
  }

  let response: { ok: boolean; message?: string };
  try {
    response = await input.request();
  } catch (error) {
    try {
      const reconciled = await reconcileAfterAmbiguousSave();
      if (reconciled?.covered) return coveredAdvance(reconciled.remaining, true);
    } catch {
      // Keep the original timeout/network failure when refresh also fails.
    }
    throw error;
  }
  if (!response.ok) {
    if (isAllocationOverlapMessage(response.message) && input.savedKey) {
      try {
        const reconciled = await reconcileAfterAmbiguousSave();
        if (reconciled?.covered) return coveredAdvance(reconciled.remaining, true);
        if (reconciled) {
          return failed(allocationSaveErrorMessage(response), {
            refreshed: true,
            persistConfirmed: true,
            queue: reconciled.remaining,
          });
        }
      } catch {
        return failed(allocationSaveErrorMessage(response));
      }
    }
    return failed(allocationSaveErrorMessage(response));
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
      recovered: false,
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
      recovered: false,
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
    recovered: false,
  };
}
