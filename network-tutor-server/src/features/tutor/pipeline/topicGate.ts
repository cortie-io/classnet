import { config } from "../../../config.js";
import { activeEmbeddingProvider } from "../../../infrastructure/llm/embedding.js";
import type { HybridRetrieveResult } from "../../../infrastructure/search/hybridSearch.js";
import {
	getNode,
	type ConceptNode,
} from "../../../infrastructure/search/corpus.js";
import {
	bm25Index,
	tokenize,
} from "../../../infrastructure/search/textIndex.js";

// "관련 문제 뽑아줘"에서 검색 1순위 개념 노드를 그 대화의 주제로 믿어도 되는지 가르는 기준.
// 예전에는 벡터 유사도 0.5(bge-m3 실측값) 하나로만 갈랐는데, (1) 임베딩 모델마다 유사도 척도가 달라
// OpenAI로 바꾸면 그 값이 의미가 없고, (2) 임베딩 없이 BM25만으로 검색할 때는 점수가 늘 0이라 모든
// 요청이 "주제 없음"이 됐다. 그래서 검색 모드마다 다른 기준을 쓴다.
//   - hybrid: 1순위 노드의 벡터 유사도 ≥ EMBED_MIN_TOPIC_SCORE(모델별, 재임베딩 뒤 다시 맞출 값)
//   - bm25_only: 요청 문구("관련", "문제", "뽑아줘"...)를 뺀 주제 부분만으로 BM25를 다시 돌려, 1위 점수가
//     BM25_MIN_TOPIC_SCORE 이상이고 2위보다 BM25_MIN_TOPIC_MARGIN 이상 앞설 때만 믿는다.
// BM25 기준값(3.5 / 0.25)은 실제 참조 문서(정규화_참조데이터_final.md)로 만든 색인에서 잰 값이다:
// 주제가 없는 요청("관련 문제 뽑아줘", "비슷한 문제 더 줘", "문제 3개 내줘")은 요청 문구를 빼면 0~1.9,
// 주제가 있는 요청은 "포트 443" 5.8(차이 0.39), "ext4 저널링" 17.2, "RAID 5" 8.3, "OSPF" 4.4였다.
// 요청 문구를 빼지 않으면 "문제"라는 단어 하나가 무관한 노드에 4.7점을 줘서 주제 없는 요청도 통과했다.
// 코드 주석에 남은 실사용 사례 중 "173을 2진수로 변환"(엉뚱한 노드가 차이 0.04로 1위)과
// "제로트러스트"(참조 문서에 없음)는 이 기준에서도 걸러진다.

const PRACTICE_REQUEST_PHRASES = [
	"관련된",
	"관련",
	"연습문제",
	"기출문제",
	"문제도",
	"문제를",
	"문제",
	"문항",
	"기출",
	"유형",
	"출제",
	"추천",
	"주제",
	"뽑아줄",
	"뽑아줘",
	"뽑아",
	"내줄래",
	"내줘",
	"내주",
	"만들어줘",
	"만들어",
	"풀어볼래",
	"풀어볼",
	"풀고",
	"풀어",
	"보여줘",
	"주세요",
	"줄래",
	"해줘",
	"해주세요",
	"싶어요",
	"싶어",
	"있어",
	"있을까",
	"있나요",
	"할래",
	"비슷한",
	"이거랑",
	"거랑",
	"이것과",
	"이걸로",
	"이걸",
	"그거",
	"방금",
	"같은",
	"다른",
	"새로운",
	"다시",
	"아무거나",
	"랜덤",
	"개만",
	"내용으로",
	"내용",
	"으로",
	"하는",
	"좀",
	"더",
	"또",
	"개",
	"만",
	"수",
	"줘",
	"로",
	"을",
	"를",
	"도",
	"이",
];
const PRACTICE_STOP_TOKENS = new Set(
	PRACTICE_REQUEST_PHRASES.flatMap((p) => tokenize(p)),
);

/** BM25 주제 판단에 쓸 토큰 — 연습문제 요청 문구와 개수("3개"의 3 같은 1~2자리 숫자)를 뺀 나머지. */
export function topicTokens(text: string): string[] {
	return tokenize(text).filter(
		(t) => !PRACTICE_STOP_TOKENS.has(t) && !/^\d{1,2}$/.test(t),
	);
}

/** hybrid 모드의 벡터 유사도 기준. 설정이 없으면 bge-m3는 원래 실측값 0.5, OpenAI는 임시값 0.4. */
export function embedMinTopicScore(): number {
	if (config.embedMinTopicScore !== undefined) return config.embedMinTopicScore;
	return activeEmbeddingProvider() === "ollama" ? 0.5 : 0.4;
}

export interface TopicDecision {
	/** 주제로 믿어도 되는 개념 노드. 기준에 못 미치면 null. */
	node: ConceptNode | null;
	basis: "vector" | "bm25";
	score: number | null;
	margin: number | null;
}

export function confidentTopic(
	retrieval: HybridRetrieveResult,
	query: string,
): TopicDecision {
	if (retrieval.mode === "hybrid" && retrieval.topVectorScore !== null) {
		const ok = retrieval.topVectorScore >= embedMinTopicScore();
		return {
			node: ok ? (retrieval.primary[0]?.node ?? null) : null,
			basis: "vector",
			score: retrieval.topVectorScore,
			margin: null,
		};
	}
	const tokens = topicTokens(query);
	if (tokens.length === 0)
		return { node: null, basis: "bm25", score: 0, margin: null };
	const [first, second] = bm25Index.search(tokens.join(" "), 2);
	if (!first) return { node: null, basis: "bm25", score: 0, margin: null };
	const margin = (first.score - (second?.score ?? 0)) / first.score;
	const ok =
		first.score >= config.bm25MinTopicScore &&
		margin >= config.bm25MinTopicMargin;
	return {
		node: ok ? (getNode(first.nodeId) ?? null) : null,
		basis: "bm25",
		score: first.score,
		margin,
	};
}
