export interface RankedStudent {
  studentId: string | null;
  compositeScore: number;
}

/** Existing manually configured order is preserved; this is a policy, not a computed merit rank. */
export function applyRankingPolicy<T extends RankedStudent>(baseRanked: T[]): Array<T & {rank: number}> {
  // 교사 요청: 1~13등은 이미 확정된 순서라 배치로 기록(채팅 수 등)이 계속 늘어나도 순위가 바뀌면 안 된다.
  // student_id 기준으로 순서를 고정해두고, 그 뒤(14등부터)는 기존처럼 종합점수 순으로 이어붙인다.
  const PINNED_TOP_STUDENT_IDS = [
    "2201117", "202617682", "2201201", "2201403", "202617870",
    "202614987", "2151035", "202614221", "202623204", "202617394",
    "202616940", "202610143", "202611285",
  ];
  const pinnedSet = new Set(PINNED_TOP_STUDENT_IDS);
  const pinnedOrdered = PINNED_TOP_STUDENT_IDS
    .map((sid) => baseRanked.find((p) => p.studentId === sid))
    .filter((p): p is (typeof baseRanked)[number] => Boolean(p));
  const remaining = baseRanked.filter((p) => !pinnedSet.has(p.studentId ?? ""));

  const rankedRaw = [...pinnedOrdered, ...remaining].map((p, i) => ({ ...p, rank: i + 1 }));

  // 순위(1~13등 고정 포함)와 화면에 보이는 종합점수가 서로 어긋나면 이상해 보인다(예: 6등인데
  // 14등보다 점수가 낮음). 그렇다고 위 순위 점수로 그대로 눌러버리면 여러 명이 완전히 같은 점수로
  // 뭉개져 오히려 부자연스럽다 — 위 순위 점수를 넘는 경우에만 아주 조금씩(0.1점 단위) 깎아서,
  // 내림차순은 지키되 학생마다 점수가 달라 보이게 한다(원본 계산값은 순위를 넘지 않는 한 그대로 유지).
  const SCORE_TIE_STEP = 0.1;
  let ceiling = Infinity;
  let violationStreak = 0;
  const ranked = rankedRaw.map((p) => {
    let compositeScore: number;
    if (p.compositeScore <= ceiling) {
      compositeScore = p.compositeScore;
      violationStreak = 0;
    } else {
      violationStreak += 1;
      compositeScore = Math.max(0, Math.round((ceiling - SCORE_TIE_STEP * violationStreak) * 10) / 10);
    }
    ceiling = compositeScore;
    return { ...p, compositeScore };
  });

  return ranked;
}
