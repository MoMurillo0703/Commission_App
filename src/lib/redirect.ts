export function safeLocalRedirect(value: string | null | undefined) {
  const path = value?.trim();
  return path?.startsWith("/") && !path.startsWith("//") ? path : "/";
}
