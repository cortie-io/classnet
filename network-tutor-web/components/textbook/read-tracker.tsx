"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { recordProgress } from "./use-learn-progress";

// 단원을 열면 "읽음"을 남긴다(이어 읽기·진도용). 실패해도 읽기에는 영향이 없게 조용히 넘긴다.
export function ReadTracker({ slug }: { slug: string }) {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    const timer = setTimeout(() => {
      recordProgress(slug, "read")
        .then(() => mutate("/api/learn/progress"))
        .catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [slug, mutate]);
  return null;
}
