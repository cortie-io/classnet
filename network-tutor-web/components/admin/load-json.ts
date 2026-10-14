import { toast } from "@/components/chat/toast";

/**
 * 관리자 화면 데이터 불러오기. 예전엔 `fetch().then(r => r.json()).then(setX)`라서 백엔드가 재시작 중이거나
 * 오류를 내면 `{ error }` 객체가 배열·객체 state에 그대로 들어가 `.map`에서 터지고 화면 전체가 하얗게 됐다.
 * 응답이 실패면 state는 그대로 두고(직전 정상 데이터 유지) 오류 토스트만 띄운다.
 */
export async function loadJson<T>(url: string, onData: (data: T) => void, init?: RequestInit): Promise<void> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = data && typeof data.error === "string" ? data.error : `불러오기 실패 (${res.status})`;
      throw new Error(message);
    }
    onData(data as T);
  } catch (err) {
    toast({ type: "error", description: err instanceof Error ? err.message : "불러오는 중 오류가 발생했습니다." });
  }
}
