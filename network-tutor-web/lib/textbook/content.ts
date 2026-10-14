import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALL_LESSONS, findLesson } from "./curriculum";

// 교재 본문(content/textbook/<slug>.md)을 읽어 화면이 그리기 좋은 조각으로 나눈다.
// 콜아웃(> [!NOTE] …)은 마크다운 바깥에서 직접 그려야 해서(Streamdown은 인용문 표시를 모른다) 여기서 잘라 낸다.

export type CalloutType =
  | "goal"
  | "note"
  | "tip"
  | "exam"
  | "warning"
  | "answer";
const CALLOUTS = new Set<CalloutType>([
  "goal",
  "note",
  "tip",
  "exam",
  "warning",
  "answer",
]);

export type Segment =
  | { kind: "md"; text: string }
  | { kind: "callout"; type: CalloutType; text: string };

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

export interface ParsedLesson {
  segments: Segment[];
  headings: Heading[];
  minutes: number;
}

const DIR = path.join(process.cwd(), "content", "textbook");

/** 제목 글자 → 문서 안 링크용 id. 화면의 제목 컴포넌트도 같은 함수를 쓴다(lesson-body.tsx). */
export function headingId(text: string): string {
  return (
    "h-" +
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/** 제목 줄의 마크다운 표시(굵게·코드·링크)를 벗겨 화면에 보이는 글자만 남긴다. */
function plainHeading(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/** 4지선다 보기(①②③④)가 한 줄씩 이어 쓰여 있으면 마크다운이 한 문단으로 붙여 버린다 — 줄바꿈을 살린다. */
function keepChoiceLineBreaks(text: string): string {
  return text.replace(/([^\n])\n(?=[①②③④⑤])/g, "$1  \n");
}

export function parseLesson(markdown: string): ParsedLesson {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const segments: Segment[] = [];
  const headings: Heading[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) segments.push({ kind: "md", text: keepChoiceLineBreaks(text) });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const callout = /^>\s*\[!([A-Za-z]+)\]\s*(.*)$/.exec(line);
      if (callout && CALLOUTS.has(callout[1].toLowerCase() as CalloutType)) {
        flush();
        const body: string[] = callout[2] ? [callout[2]] : [];
        while (i + 1 < lines.length && /^>/.test(lines[i + 1])) {
          i++;
          body.push(lines[i].replace(/^>\s?/, ""));
        }
        segments.push({
          kind: "callout",
          type: callout[1].toLowerCase() as CalloutType,
          text: keepChoiceLineBreaks(body.join("\n").trim()),
        });
        continue;
      }
      const heading = /^(##|###)\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        const text = plainHeading(heading[2]);
        headings.push({
          depth: heading[1].length as 2 | 3,
          text,
          id: headingId(text),
        });
      }
    }
    buffer.push(line);
  }
  flush();

  // 한글 기준 분당 약 500자로 읽는다고 보고 계산한다(코드·표가 섞여 있어 넉넉히).
  const chars = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, "").length;
  return { segments, headings, minutes: Math.max(3, Math.round(chars / 500)) };
}

export function readLessonMarkdown(slug: string): string | null {
  if (!findLesson(slug)) return null;
  try {
    return readFileSync(path.join(DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

export function loadLesson(slug: string): ParsedLesson | null {
  const md = readLessonMarkdown(slug);
  return md === null ? null : parseLesson(md);
}

/** 목차 화면용 — 단원마다 읽는 시간. */
export function lessonMinutes(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of ALL_LESSONS) {
    const md = readLessonMarkdown(l.slug);
    out[l.slug] = md ? parseLesson(md).minutes : 0;
  }
  return out;
}
