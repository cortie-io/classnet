import { ALL_LESSONS, type QuizTopic } from "@/lib/textbook/curriculum";
import TERM_WEIGHTS from "@/lib/textbook/term-weights.json";

// 문제 지문이 어느 교재 단원 이야기인지 고른다 — 단원 확인 문제를 고를 때 쓰는 주제어(curriculum.ts quiz.terms)를
// 그대로 쓴다. 틀린 문제에서 "관련 단원 읽기", 오답노트의 "자주 틀리는 단원"에 쓴다.
// 서버를 거치지 않고 화면에서 바로 계산한다(문제 지문은 이미 받아 와 있다).

// 문제의 과목 값 → 단원 확인 문제 과목 묶음(서버 learnService TOPIC_BUCKET의 반대 방향)
const SUBJECT_TOPIC: Record<string, QuizTopic> = {
  "1과목_네트워크_일반": "general",
  "2과목_TCP_IP": "tcpip",
  "3과목_NOS": "nos",
  "4과목_네트워크_운용기기": "devices",
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 서버 practiceTopic.ts termPattern과 같은 규칙: 짧은 영문 약어는 영숫자 경계로("IP"가 "VIP"에 맞지 않게,
// "OSPF에"는 맞게), 한글은 글자 사이 띄어쓰기 차이를 흡수한다.
function termRegex(term: string): RegExp {
  const t = term.trim();
  if (/^[A-Za-z][A-Za-z0-9.+\-/]*$/.test(t)) {
    return new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(t)}($|[^A-Za-z0-9])`, "i");
  }
  return new RegExp(
    Array.from(t.replace(/\s+/g, ""))
      .map((ch) => escapeRegex(ch))
      .join("\\s*"),
    "i"
  );
}

// 흔한 말("Linux", "명령어", "계층")은 거의 모든 단원 지문에 나와 단원을 가르지 못한다 — 문제은행 전체에서
// 드물게 나오는 말일수록 무겁게 센다(term-weights.json: ln(N/df), 문제은행에서 계산해 둔 값. 없으면 보통 무게).
const BASELINE = 2;
function termWeight(term: string): number {
  const idf = (TERM_WEIGHTS as Record<string, number>)[term] ?? 5;
  return Math.max(idf - BASELINE, 0.2);
}

const MATCHERS = ALL_LESSONS.filter((l) => l.quiz).map((l) => ({
  partLabel: l.part.label,
  slug: l.slug,
  terms: (l.quiz?.terms ?? []).map((t) => ({
    re: termRegex(t),
    term: t,
    weight: termWeight(t),
  })),
  title: l.title,
  topic: l.quiz?.topic as QuizTopic,
}));

const MIN_SCORE = 1.5;
const LINUX_LESSON = /^nos-(linux|vi)/;

export interface LessonMatch {
  partLabel: string;
  slug: string;
  title: string;
}

/** 지문에 단원 주제어가 많이 나올수록, 과목이 같을수록 높은 점수. 아무 주제어도 안 나오면 null. */
export function matchLesson(
  stem: string,
  choices: string[] | null | undefined,
  subject?: string | null
): LessonMatch | null {
  const choiceText = (choices ?? []).join(" ");
  const topic = subject ? SUBJECT_TOPIC[subject] : undefined;
  // "권한", "명령어"처럼 두 운영체제 단원에 다 있는 말 때문에 Windows 문제가 Linux 단원으로 가지 않게
  const windows = /windows|윈도우/i.test(stem);
  const linux = /linux|리눅스|unix|유닉스/i.test(stem);
  let best: { m: (typeof MATCHERS)[number]; score: number } | null = null;
  for (const m of MATCHERS) {
    let score = 0;
    for (const { re, weight } of m.terms) {
      if (re.test(stem)) {
        score += weight;
      } else if (re.test(choiceText)) {
        score += weight / 2;
      }
    }
    if (score === 0) {
      continue;
    }
    if (topic && m.topic === topic) {
      score *= 1.3;
    }
    if (windows && !linux && LINUX_LESSON.test(m.slug)) {
      score *= 0.3;
    }
    if (linux && !windows && m.slug.startsWith("nos-windows")) {
      score *= 0.3;
    }
    if (!best || score > best.score) {
      best = { m, score };
    }
  }
  // 흔한 말 하나만 걸린 정도는 우연일 수 있어 버린다
  if (!best || best.score < MIN_SCORE) {
    return null;
  }
  return {
    partLabel: best.m.partLabel,
    slug: best.m.slug,
    title: best.m.title,
  };
}
