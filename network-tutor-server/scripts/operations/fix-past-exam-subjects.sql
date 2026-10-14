-- ===== 2026-10-14 기출문제 과목 값 바로잡기 =====
-- 기출 시험지 1~10번(내용은 TCP/IP)에 '1과목_네트워크_일반', 11~27번(내용은 네트워크 일반)에 '2과목_TCP_IP'가 붙어 있었다.
-- 적재할 때 시험지의 문항 위치를 시행처 과목 순서(네트워크일반·TCP/IP·NOS·운용기기)로 옮긴 탓이다 — '1과목_네트워크_일반' 기출의
-- 약 73%가 IP·TCP·UDP·서브넷·DNS 주제였고, 변조·다중화·CRC·HDLC는 '2과목_TCP_IP' 쪽에 있었다.
-- 기출(source='past_exam')만 두 값을 맞바꾼다. AI가 만든 문제와 개념 노드는 처음부터 내용대로 붙어 있어 건드리지 않는다.
-- 맞바꾸기는 두 번 하면 되돌아가므로 data_fixes에 한 번 한 것을 기록한다.
CREATE TABLE IF NOT EXISTS data_fixes (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM data_fixes WHERE name = '2026-10-14-past-exam-subject-swap') THEN
    UPDATE exam_questions
       SET subject = CASE subject WHEN '1과목_네트워크_일반' THEN '2과목_TCP_IP' ELSE '1과목_네트워크_일반' END
     WHERE source = 'past_exam' AND subject IN ('1과목_네트워크_일반', '2과목_TCP_IP');
    INSERT INTO data_fixes (name) VALUES ('2026-10-14-past-exam-subject-swap');
  END IF;
END $$;
-- ===== 끝: 기출문제 과목 값 바로잡기 =====
