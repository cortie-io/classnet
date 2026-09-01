import { pool } from "../db/pool.js";
import { chat } from "../llm/ollama.js";
import type { GeneratedQuestion } from "./questionTypes.js";

interface NodeRow {
  id: number;
  subject: string;
  title: string;
  section_no: string;
  body_text: string;
}

interface RawGenerated {
  stem: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

async function generateOne(node: NodeRow): Promise<RawGenerated | null> {
  const systemPrompt =
    "당신은 네트워크관리사 2급 필기시험 문제 출제 위원입니다. 주어진 [교재 내용]에 나온 사실만 근거로 " +
    "4지선다 객관식 문제 1개를 만드세요. 정답 선지는 교재 내용에 명시적으로 있는 사실이어야 하고, " +
    "나머지 3개 오답 선지는 그럴듯하지만 교재 내용과 명백히 다른 값/설명이어야 합니다(같은 주제의 " +
    "다른 개념과 헷갈리게 만들지 마세요 — 아예 다른 주제를 섞지 말고, 같은 개념 안에서 수치나 용어를 " +
    "바꾼 오답을 만드세요). 반드시 아래 JSON 형식으로만 답하고 다른 설명은 절대 추가하지 마세요.\n" +
    '{"stem": "문제 지문", "choices": ["선지1","선지2","선지3","선지4"], "correctIndex": 0, "explanation": "정답 해설"}';
  const userPrompt = `[개념: ${node.subject} > ${node.title}]\n[교재 내용]\n${node.body_text.slice(0, 3000)}`;

  try {
    const raw = await chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.4 },
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as RawGenerated;
    if (
      typeof parsed.stem !== "string" ||
      !Array.isArray(parsed.choices) ||
      parsed.choices.length !== 4 ||
      parsed.choices.some((c) => typeof c !== "string" || c.trim().length === 0) ||
      typeof parsed.correctIndex !== "number" ||
      parsed.correctIndex < 0 ||
      parsed.correctIndex > 3
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 어휘 중첩만으로는 부족하다 — 선지가 "브로드캐스트/유니캐스트/멀티캐스트"처럼 같은 표/문단에서 나온
 * 짧은 용어들이면, 오답조차 원문에 그대로 존재해서 정답과 똑같이 100% 겹친다(실측 확인됨). 그래서
 * "이 선지가 원문에 있는가"가 아니라 "이 정답이 이 문제에 실제로 맞는가"를 별도 LLM 사실검증
 * 패스로 판정한다 — 메인 답변 파이프라인의 자기검증과 동일한 원리를 문제 생성에도 적용한 것이다.
 */
async function verifyWithLLM(node: NodeRow, q: RawGenerated): Promise<{ ok: boolean; reason?: string }> {
  const verifierPrompt = `당신은 네트워크관리사 2급 시험 문제의 엄격한 검수위원입니다. 아래 [교재 내용]만
근거로 [문제]의 정답 지정이 실제로 옳은지, 그리고 나머지 선지들이 명백히 틀렸는지 판단하세요.
반드시 아래 JSON 형식으로만 답하세요.
{"valid": true 또는 false, "reason": "한 문장 이유"}

[교재 내용]
${node.body_text.slice(0, 3000)}

[문제]
${q.stem}
선지: ${q.choices.map((c, i) => `${i + 1}) ${c}`).join(" / ")}
지정된 정답: ${q.correctIndex + 1}) ${q.choices[q.correctIndex]}`;

  try {
    const raw = await chat(
      [
        { role: "system", content: "You are a strict exam question reviewer. Respond with JSON only." },
        { role: "user", content: verifierPrompt },
      ],
      { temperature: 0 },
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, reason: "검증 응답 파싱 실패" };
    const parsed = JSON.parse(jsonMatch[0]) as { valid: boolean; reason?: string };
    return { ok: !!parsed.valid, reason: parsed.reason };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateConceptQuestions(limit?: number): Promise<{ accepted: GeneratedQuestion[]; discarded: number }> {
  const { rows: nodes } = await pool.query<NodeRow>(
    `SELECT id, subject, title, section_no, body_text FROM concept_nodes ORDER BY order_index`,
  );
  const targets = limit ? nodes.slice(0, limit) : nodes;

  const accepted: GeneratedQuestion[] = [];
  let discarded = 0;

  for (const node of targets) {
    const raw = await generateOne(node);
    if (!raw) {
      discarded++;
      continue;
    }
    const verdict = await verifyWithLLM(node, raw);
    if (!verdict.ok) {
      discarded++;
      continue;
    }
    accepted.push({
      subject: node.subject,
      conceptNodeId: node.id,
      stem: raw.stem,
      choices: raw.choices,
      correctIndex: raw.correctIndex,
      explanation: raw.explanation,
      sourceDetail: { generator: "concept_llm" },
    });
  }

  return { accepted, discarded };
}
