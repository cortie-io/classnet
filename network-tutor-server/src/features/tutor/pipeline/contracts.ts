import { type ProviderChoice } from "../../../infrastructure/llm/provider.js";
import { type ChatProviderName } from "../../../infrastructure/llm/types.js";
import { type SourceFootnote } from "./context.js";
import { type AskErrorCode } from "./askError.js";
import { type AttemptQuestionView } from "../../exams/services/examService.js";
import type { CalcResult } from "../../../domain/network/calculators.js";

export type Intent =
	| "calc"
	| "lookup"
	| "explain"
	| "practice_request"
	| "out_of_scope";
export type VerificationStatus =
	| "pending"
	| "verified"
	| "flagged"
	| "cached"
	| "rule_only";
export type StudentLevel = "beginner" | "intermediate" | "advanced";

export interface HistoryTurn {
	role: "user" | "assistant";
	content: string;
}

export interface RequesterContext {
	userId: number;
	level: StudentLevel;
	provider: ProviderChoice;
	imageBase64?: string;
	/** 첨부 이미지 형식(image/png 등). 없으면 base64 시그니처로 추정한다(llm/types.ts normalizeImage). */
	imageMime?: string;
	// 채팅 UI의 이전 대화(직전 턴들)를 함께 보내 꼬리질문("그거 좀 더 쉽게", "왜 그런데?")을 이해하게 한다.
	// /problem 같은 단발성 입력에는 없다.
	history?: HistoryTurn[];
	// answerQuestion()이 요청당 한 번만 채워 넣는다 — runCalc/runRetrieval/runLookup은 그냥 읽기만 한다.
	weakAreaNote?: string;
	cacheTag?: string;
}

export interface AnswerResponse {
	question: string;
	intent: Intent;
	answer: string;
	sources: SourceFootnote[];
	ontologyPath: string[];
	calcTrace: CalcResult | null;
	confidence: number | null;
	verificationStatus: VerificationStatus;
	cached: boolean;
	auditLogId: number | null;
	providerUsed: ChatProviderName | null;
	// 답을 만들지 못하고 대체 문구를 돌려준 경우에만 채운다. 채팅 화면(network-tutor-model.ts)은 이 값이
	// 있으면 고정된 안내 문구를 보여 주고, 그 턴을 다음 질문의 이전 대화로 다시 보내지 않는다.
	errorCode?: AskErrorCode;
	// practice_request일 때만 채워진다 — 채팅 안에서 바로 풀어볼 수 있는 실제 문제은행 문제(연습 응시로 미리 생성됨).
	practiceAttempt?: {
		attemptId: number;
		questions: AttemptQuestionView[];
	} | null;
}
