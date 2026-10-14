export function adminPeriodUrl(input: string, period?: string): string {
  if (
    !/^\/api\/(admin(?:\/|$)|audit(?:\/|\?|$)|audit-summary(?:\/|$))/.test(
      input
    )
  )
    return input;
  const selected =
    period ??
    (typeof window === "undefined"
      ? "2"
      : (new URLSearchParams(window.location.search).get("period") ?? "2"));
  const url = new URL(input, "http://admin.internal");
  url.searchParams.set("period", selected === "1" ? "1" : "2");
  return url.pathname + url.search;
}
export function adminFetch(input: string, init?: RequestInit) {
  return fetch(adminPeriodUrl(input), { ...init, cache: "no-store" });
}
