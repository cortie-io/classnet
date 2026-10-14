import { toast } from "@/components/chat/toast";

/**
 * 화면 데이터 불러오기. 예전엔 `fetch().then(r => r.json()).then(setX)`라서 백엔드가 재시작 중이거나
 * 오류를 내면 `{ error }` 객체가 배열·객체 state에 그대로 들어가 `.map`에서 터지고 화면 전체가 하얗게 됐다.
 * 응답이 실패면 onData를 부르지 않고(직전 정상 데이터 유지) 오류 토스트를 띄운 뒤 onError를 부른다.
 */
export async function loadJson<T>(
  url: string,
  onData: (data: T) => void,
  opts: { init?: RequestInit; onError?: (message: string) => void; quiet?: boolean } = {},
): Promise<void> {
  try {
    const res = await fetch(url, opts.init);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = data && typeof data.error === "string" ? data.error : `불러오기 실패 (${res.status})`;
      throw new Error(message);
    }
    onData(data as T);
  } catch (err) {
    const message = err instanceof Error ? err.message : "불러오는 중 오류가 발생했습니다.";
    if (!opts.quiet) toast({ type: "error", description: message });
    opts.onError?.(message);
  }
}
