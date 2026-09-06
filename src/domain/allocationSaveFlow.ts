import { afterSaveQueue } from "./compensationQueue";
import {
  allocationConflictReviewMessage,
  classifyRequestedAllocation,
  classifyRequestedAllocationSet,
  teamMemberTermsById,
  type AllocationTerms,
  type PersistedAllocationTerms,
} from "./allocationTerms";

export { allocationConflictReviewMessage };

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
  return "This Group + LOB already has the same allocation you tried to save. Continuing with the next item.";
}

export function allocationIntegrityRecoveryMessage() {
  return "The requested allocations could not be confirmed as one complete saved set. Existing allocations were not changed.";
}

export function bulkAllocationSavedMessage(count: number) {
  return `Applied group compensation to ${count} line${count === 1 ? "" : "s"}. Posted commissions keep their original payout snapshots.`;
}

type QueueItem = { key: string };

type RefreshResult<T extends QueueItem> = {
  queue: T[];
  allocations?: PersistedAllocationTerms[];
  teams?: Array<{
    id: number;
    members: Array<{
      personKind: "agent" | "account_manager";
      personId: number;
      shareBps: number;
      status?: string;
      effectiveStart: string;
      effectiveEnd: string | null;
    }>;
  }>;
};

function teamsMapFromRefresh<T extends QueueItem>(
  refreshed: RefreshResult<T>,
  submitted?: AllocationTerms | AllocationTerms[] | null,
) {
  const first = Array.isArray(submitted) ? submitted[0] : submitted;
  if (!refreshed.teams || !first) return undefined;
  return teamMemberTermsById(refreshed.teams, first.effectiveStart);
}

export async function runAllocationSaveFlow<T extends QueueItem>(input: {
  request: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<RefreshResult<T>>;
  submitted?: AllocationTerms | null;
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

  async function classifyAfterAmbiguousSave() {
    if (!input.submitted) return null;
    const refreshed = await input.refresh();
    const classified = classifyRequestedAllocation(
      refreshed.allocations ?? [],
      input.submitted,
      teamsMapFromRefresh(refreshed, input.submitted),
    );
    return { refreshed, classified };
  }

  let response: { ok: boolean; message?: string };
  try {
    response = await input.request();
  } catch (error) {
    try {
      const recovered = await classifyAfterAmbiguousSave();
      if (recovered?.classified.status === "exact") {
        if (input.savedKey && recovered.refreshed.queue.some((item) => item.key === input.savedKey)) {
          return {
            error: null as string | null,
            success: allocationStillQueuedMessage(),
            notice: null as string | null,
            queue: recovered.refreshed.queue,
            queueIndex: input.queueIndex,
            queueDone: false,
            queueOpen: true,
            refreshed: true,
            persistConfirmed: true,
            stillQueued: true,
            loadNext: false,
            recovered: true,
          };
        }
        return coveredAdvance(recovered.refreshed.queue, true);
      }
      if (recovered?.classified.status === "conflict") {
        return failed(allocationConflictReviewMessage(), {
          refreshed: true,
          persistConfirmed: true,
          queue: recovered.refreshed.queue,
        });
      }
    } catch {
      // Keep the original timeout/network failure when refresh also fails.
    }
    throw error;
  }
  if (!response.ok) {
    if (isAllocationOverlapMessage(response.message) || /different compensation allocation already exists/i.test(response.message ?? "")) {
      try {
        const recovered = await classifyAfterAmbiguousSave();
        if (recovered?.classified.status === "exact") {
          if (input.savedKey && recovered.refreshed.queue.some((item) => item.key === input.savedKey)) {
            return {
              error: null as string | null,
              success: allocationStillQueuedMessage(),
              notice: null as string | null,
              queue: recovered.refreshed.queue,
              queueIndex: input.queueIndex,
              queueDone: false,
              queueOpen: true,
              refreshed: true,
              persistConfirmed: true,
              stillQueued: true,
              loadNext: false,
              recovered: true,
            };
          }
          return coveredAdvance(recovered.refreshed.queue, true);
        }
        if (recovered?.classified.status === "conflict") {
          return failed(allocationConflictReviewMessage(), {
            refreshed: true,
            persistConfirmed: true,
            queue: recovered.refreshed.queue,
          });
        }
        if (recovered) {
          return failed(allocationSaveErrorMessage(response), {
            refreshed: true,
            persistConfirmed: false,
            queue: recovered.refreshed.queue,
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

export async function runBulkAllocationSaveFlow<T extends QueueItem>(input: {
  request: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<RefreshResult<T>>;
  submitted: AllocationTerms[];
}) {
  const failed = (error: string, extras: { refreshed?: boolean; persistConfirmed?: boolean; queue?: T[] } = {}) => ({
    error,
    success: null as string | null,
    notice: null as string | null,
    queue: extras.queue ?? [] as T[],
    refreshed: extras.refreshed ?? false,
    persistConfirmed: extras.persistConfirmed ?? false,
    recovered: false,
  });

  async function classifyAfterAmbiguousSave() {
    const refreshed = await input.refresh();
    return {
      refreshed,
      classified: classifyRequestedAllocationSet(
        refreshed.allocations ?? [],
        input.submitted,
        teamsMapFromRefresh(refreshed, input.submitted),
      ),
    };
  }

  let response: { ok: boolean; message?: string };
  try {
    response = await input.request();
  } catch (error) {
    try {
      const recovered = await classifyAfterAmbiguousSave();
      if (recovered.classified.status === "exact") {
        return {
          error: null as string | null,
          success: bulkAllocationSavedMessage(input.submitted.length),
          notice: null as string | null,
          queue: recovered.refreshed.queue,
          refreshed: true,
          persistConfirmed: true,
          recovered: true,
        };
      }
      if (recovered.classified.status === "conflict") {
        return failed(allocationConflictReviewMessage(), {
          refreshed: true,
          persistConfirmed: true,
          queue: recovered.refreshed.queue,
        });
      }
      if (recovered.classified.status === "partial") {
        return failed(allocationIntegrityRecoveryMessage(), {
          refreshed: true,
          persistConfirmed: false,
          queue: recovered.refreshed.queue,
        });
      }
    } catch {
      // Keep the original timeout/network failure when refresh also fails.
    }
    throw error;
  }
  if (!response.ok) {
    if (isAllocationOverlapMessage(response.message) || /different compensation allocation already exists/i.test(response.message ?? "")) {
      try {
        const recovered = await classifyAfterAmbiguousSave();
        if (recovered.classified.status === "exact") {
          return {
            error: null as string | null,
            success: bulkAllocationSavedMessage(input.submitted.length),
            notice: null as string | null,
            queue: recovered.refreshed.queue,
            refreshed: true,
            persistConfirmed: true,
            recovered: true,
          };
        }
        if (recovered.classified.status === "conflict") {
          return failed(allocationConflictReviewMessage(), {
            refreshed: true,
            persistConfirmed: true,
            queue: recovered.refreshed.queue,
          });
        }
        if (recovered.classified.status === "partial") {
          return failed(allocationIntegrityRecoveryMessage(), {
            refreshed: true,
            persistConfirmed: false,
            queue: recovered.refreshed.queue,
          });
        }
      } catch {
        return failed(allocationSaveErrorMessage(response));
      }
    }
    return failed(allocationSaveErrorMessage(response));
  }
  const refreshed = await input.refresh();
  return {
    error: null as string | null,
    success: bulkAllocationSavedMessage(input.submitted.length),
    notice: null as string | null,
    queue: refreshed.queue,
    refreshed: true,
    persistConfirmed: true,
    recovered: false,
  };
}
