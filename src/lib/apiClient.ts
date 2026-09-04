export function httpFailureMessage(status: number, serverMessage?: string | null) {
  const detailed = serverMessage?.trim();
  if (detailed) return detailed;
  if (status === 401) return "Sign in is required.";
  if (status === 408 || status === 504) return "The database request timed out. Try again.";
  if (status === 503) return "The database is temporarily unavailable. Try again.";
  if (status >= 500) return "The server could not finish this request. Try again.";
  return "Unable to complete that request.";
}

export async function readApiJson<T extends Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(httpFailureMessage(response.status));
  }
}

export async function runBusyAction(setBusy: (busy: boolean) => void, action: () => Promise<void>) {
  setBusy(true);
  try {
    await action();
  } finally {
    setBusy(false);
  }
}
