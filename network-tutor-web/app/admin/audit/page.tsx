"use client";

import { useEffect, useState } from "react";
import { ScrollTextIcon } from "lucide-react";
import { PageIntro } from "@/components/chat/page-intro";
import { Button } from "@/components/ui/button";

interface AuditRow {
  id: number;
  user_name: string | null;
  user_email: string | null;
  question: string;
  intent: string;
  verification_status: string;
  confidence: number | null;
  reviewed: boolean;
  created_at: string;
}
interface AuditDetail extends AuditRow {
  final_answer: string;
  llm_raw_answer: string | null;
  verification_detail: unknown;
  retrieved_node_ids: number[];
}

const STATUS_OPTIONS = ["", "verified", "flagged", "cached", "rule_only"];

export default function AuditPage() {
  const [status, setStatus] = useState("");
  const [reviewed, setReviewed] = useState("");
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<{ byStatus: { verification_status: string; count: number }[]; pendingReview: number } | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);

  const load = () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (reviewed) params.set("reviewed", reviewed);
    fetch(`/api/audit?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items);
        setTotal(d.total);
      });
    fetch("/api/audit-summary/stats").then((r) => r.json()).then(setStats);
  };

  useEffect(load, [status, reviewed]);

  const openDetail = (id: number) => {
    fetch(`/api/audit/${id}`).then((r) => r.json()).then(setDetail);
  };

  const markReviewed = async (id: number) => {
    await fetch(`/api/audit/${id}/review`, { method: "POST" });
    load();
    setDetail(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageIntro description="학생 질문과 AI 답변, 검증 결과를 확인하고 검수해요." icon={ScrollTextIcon} title="질의응답 감사로그" />
      {stats && (
        <p className="text-muted-foreground text-sm">
          상태별: {stats.byStatus.map((s) => `${s.verification_status}=${s.count}`).join(", ")} · 검수 대기(flagged &
          미검수): {stats.pendingReview}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px]"
          onChange={(e) => setStatus(e.target.value)}
          value={status}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s || "전체 상태"}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px]"
          onChange={(e) => setReviewed(e.target.value)}
          value={reviewed}
        >
          <option value="">검수 전체</option>
          <option value="false">미검수만</option>
          <option value="true">검수 완료만</option>
        </select>
      </div>

      <div className="surface">
        <div className="overflow-x-auto">
          <table className="table w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-border border-b bg-muted/50 text-[12px] text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-semibold">학생</th>
                <th className="px-4 py-2.5 text-left font-semibold">질문</th>
                <th className="px-4 py-2.5 text-left font-semibold">의도</th>
                <th className="px-4 py-2.5 text-left font-semibold">상태</th>
                <th className="px-4 py-2.5 text-left font-semibold">검수</th>
                <th className="px-4 py-2.5 text-left font-semibold">시각</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  className="cursor-pointer border-border border-b last:border-0 hover:bg-accent/50"
                  key={row.id}
                  onClick={() => openDetail(row.id)}
                >
                  <td className="px-4 py-2">{row.user_name ?? "-"}</td>
                  <td className="px-4 py-2">{row.question.slice(0, 40)}</td>
                  <td className="px-4 py-2">{row.intent === "token_burn_test" ? "" : row.intent}</td>
                  <td className="px-4 py-2">{row.verification_status}</td>
                  <td className="px-4 py-2">{row.reviewed ? "✓" : ""}</td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(row.created_at).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 && <p className="p-4 text-muted-foreground text-sm">기록이 없습니다 (총 {total}건 중)</p>}
      </div>

      {detail && (
        <div className="surface p-5">
          <h2 className="mb-2 font-semibold text-[14px]">#{detail.id} — {detail.question}</h2>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">
            {JSON.stringify(
              detail,
              (key, value) =>
                key === "synthetic_demo" ||
                key.startsWith("demo_") ||
                (key === "intent" && value === "token_burn_test")
                  ? undefined
                  : value,
              2
            )}
          </pre>
          <Button className="mt-3" onClick={() => markReviewed(detail.id)} size="sm">
            검수 완료로 표시
          </Button>
        </div>
      )}
    </div>
  );
}
