export const CLIENT_REQUEST_TIMEOUT_MS = 45_000;
export const CLIENT_TIMEOUT_MESSAGE = "The request timed out. Try again.";

export class RequestTimeoutError extends Error {
  readonly timedOut = true;

  constructor() {
    super(CLIENT_TIMEOUT_MESSAGE);
    this.name = "RequestTimeoutError";
  }
}

export function httpFailureMessage(status: number, serverMessage?: string | null) {
  const detailed = serverMessage?.trim();
  if (detailed) return detailed;
  if (status === 401) return "Sign in is required.";
  if (status === 408 || status === 504) return "The database request timed out. Try again.";
  if (status === 503) return "The database is temporarily unavailable. Try again.";
  if (status >= 500) return "The server could not finish this request. Try again.";
  return "Unable to complete that request.";
}

export function requestFailureMessage(error: unknown, fallback: string) {
  if (error instanceof RequestTimeoutError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(httpFailureMessage(response.status));
  }
}

export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = CLIENT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof RequestTimeoutError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new RequestTimeoutError();
    if (error instanceof Error && error.name === "AbortError") throw new RequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
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
