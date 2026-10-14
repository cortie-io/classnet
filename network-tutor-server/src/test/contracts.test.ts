import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import http from "node:http";
import { startTestDb } from "./pgTestDb.js";

const db = await startTestDb();
const { pool } = await import("../infrastructure/db/pool.js");
const { createApp } = await import("../app.js");
const { consumeLimit, UsageLimitError } = await import("../features/auth/limits.js");
const { replacePassword } = await import("../features/auth/passwordReset.js");
const { createSession, getSessionUser } = await import("../features/auth/session.js");
const { getWeakAreas, getWeakTopics } = await import("../features/tutor/pipeline/personalization.js");
const { ingestNodes } = await import("../ingest/ingest.js");
const { applyRankingPolicy } = await import("../features/admin/rankingPolicy.js");
const { createAttempt, submitAnswer, autoSubmitIfExpired, getAttempt } = await import("../features/exams/services/examService.js");
const { updateAuditLogVerification } = await import("../features/tutor/pipeline/audit.js");
const { verifyGroundedness } = await import("../features/tutor/pipeline/verify.js");

const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const port = (server.address() as {port: number}).port;

async function call(path: string, opts: {method?: string; body?: unknown; user?: number} = {}) {
  return new Promise<{status: number; data: any}>((resolve, reject) => {
    const url = new URL(path, `http://127.0.0.1:${port}`);
    if (opts.user !== undefined) url.searchParams.set("userId", String(opts.user));
    const request = http.request(url, {
      method: opts.method ?? "GET",
      headers: {"Content-Type": "application/json", ...(opts.user === undefined ? {} : {"x-internal-secret": "test-internal-secret"})},
    }, (response) => {
      let text = "";
      response.on("data", (part) => {text += part;});
      response.on("end", () => resolve({status: response.statusCode!, data: JSON.parse(text)}));
    });
    request.on("error", reject);
    request.end(opts.body === undefined ? undefined : JSON.stringify(opts.body));
  });
}

beforeEach(async () => {
  await db.reset();
  await pool.query(`INSERT INTO users (id,role,name,email,password_hash,student_id) VALUES
    (1,'admin','admin','admin@test','invalid',null),
    (2,'student','student','student@test','invalid','test-2'),
    (3,'student','other','other@test','invalid','test-3');
    INSERT INTO concept_nodes (id,subject,category,topic,tag_path,section_no,title,body_md,body_text,order_index)
    VALUES (1,'TCP','network','transport','network/TCP','2.1','TCP','old','old',1);
    INSERT INTO exam_questions (id,source,subject,concept_node_id,stem,choices,correct_index,explanation,status)
    VALUES (1,'past_exam','TCP',1,'Question','["A","B","C","D"]',0,'Explanation','approved');
    INSERT INTO exam_sets (id,kind,title,created_by,question_ids,is_published)
    VALUES (1,'practice_custom','Practice',1,ARRAY[1],true);
    SELECT setval('exam_sets_id_seq',1,true);`);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.stop();
});

test("history traverses over 500 rows with equal timestamps; legacy response remains compatible", async () => {
  await pool.query(`INSERT INTO audit_log (user_id,question,intent,final_answer,verification_status,created_at)
    SELECT 2,'q-'||n,'token_burn_test','a-'||n,'verified','2026-01-01'::timestamptz FROM generate_series(1,550) n`);
  const all: number[] = [];
  let cursor: number | null = null;
  do {
    const response = await call(`/api/admin/users/2/history?paginated=true&limit=50${cursor === null ? "" : "&beforeId="+cursor}`, {user: 1});
    assert.equal(response.status, 200);
    assert.equal(response.data.total, 550);
    all.push(...response.data.items.map((x: {id: number}) => x.id));
    if (!response.data.hasMore) break;
    assert.notEqual(response.data.nextCursor, cursor);
    cursor = response.data.nextCursor;
  } while (true);
  assert.equal(all.length, 550);
  assert.equal(new Set(all).size, 550);
  assert.deepEqual(all, [...all].sort((a,b) => b-a));
  assert.ok(Array.isArray((await call('/api/admin/users/2/history?limit=2',{user:1})).data));
});

test("history requires admin and rejects invalid pagination instead of reaching SQL", async () => {
  assert.equal((await call('/api/admin/users/2/history')).status,401);
  assert.equal((await call('/api/admin/users/2/history',{user:2})).status,403);
  for (const query of ['limit=-1','limit=NaN','beforeId=-1','beforeId=1.5']) {
    assert.equal((await call('/api/admin/users/2/history?'+query,{user:1})).status,400);
  }
});

test("concurrent request admission cannot overshoot its limit and resets on the next window", async () => {
  const admitted = await Promise.allSettled(Array.from({length:25}, () => consumeLimit('test:limit',5,900)));
  assert.equal(admitted.filter(x=>x.status==='fulfilled').length,5);
  for (const result of admitted) if (result.status==='rejected') assert.ok(result.reason instanceof UsageLimitError);
  await pool.query("UPDATE request_limits SET bucket=bucket-1 WHERE key='test:limit'");
  await consumeLimit('test:limit',5,900);
  assert.equal((await pool.query("SELECT count FROM request_limits WHERE key='test:limit'")).rows[0].count,1);
});

test("password reset advances JWT version and revokes cookie sessions atomically", async () => {
  const previous = await createSession(2);
  const other = await createSession(3);
  assert.ok(await getSessionUser(previous.token));
  assert.equal((await replacePassword(2,'new-hash'))?.id,2);
  assert.equal(await getSessionUser(previous.token),null);
  assert.ok(await getSessionUser(other.token));
  assert.equal((await pool.query('SELECT auth_version FROM users WHERE id=2')).rows[0].auth_version,1);
  assert.equal(await replacePassword(999,'new-hash'),null);
});

test("invalidated and unfinished attempts do not contaminate weak-area analysis", async () => {
  await pool.query(`INSERT INTO exam_attempts (id,exam_set_id,user_id,question_ids,status) VALUES
    (1,1,2,ARRAY[1],'submitted'),(2,1,2,ARRAY[1],'invalidated'),(3,1,2,ARRAY[1],'invalidated'),(4,1,2,ARRAY[1],'in_progress');
    INSERT INTO exam_answers (attempt_id,question_id,is_correct) VALUES (1,1,true),(2,1,false),(3,1,false),(4,1,false);`);
  assert.deepEqual(await getWeakAreas(2),[]);
  assert.deepEqual(await getWeakTopics(2),[]);
});

test("reference re-ingest preserves node IDs, bookmarks, questions and student answers", async () => {
  await pool.query(`INSERT INTO bookmarks(user_id,concept_node_id) VALUES(2,1);
    INSERT INTO exam_attempts(id,exam_set_id,user_id,question_ids,status) VALUES(1,1,2,ARRAY[1],'submitted');
    INSERT INTO exam_answers(attempt_id,question_id,is_correct) VALUES(1,1,true);`);
  const node = {subjectNum:'2',subject:'TCP',category:'network',topic:'transport',tagPath:'network/TCP',sectionNo:'2.1',title:'Updated TCP',bodyMd:'updated',bodyText:'updated',tables:[],orderIndex:1};
  await ingestNodes([node]);
  assert.equal((await pool.query('SELECT id FROM concept_nodes WHERE section_no=$1',['2.1'])).rows[0].id,1);
  for(const table of ['exam_questions','exam_answers','bookmarks']) {
    assert.equal(Number((await pool.query('SELECT count(*) FROM '+table)).rows[0].count),1);
  }
  await assert.rejects(()=>ingestNodes([node,node]),/중복/);
  assert.equal((await pool.query('SELECT title FROM concept_nodes WHERE id=1')).rows[0].title,'Updated TCP');
});

test("manually pinned ranking remains stable while remaining students retain computed order", () => {
  const ranked = applyRankingPolicy([{studentId:'other',compositeScore:100},{studentId:'202617682',compositeScore:40},{studentId:'2201117',compositeScore:50}]);
  assert.deepEqual(ranked.map(x=>x.studentId),['2201117','202617682','other']);
  assert.deepEqual(ranked.map(x=>x.rank),[1,2,3]);
  assert.equal(ranked[2].compositeScore,39.9);
});

test("a student report stays flagged when background verification finishes later", async () => {
  const {rows} = await pool.query("INSERT INTO audit_log(user_id,question,intent,final_answer,verification_status,reviewed) VALUES(2,'q','explain','a','pending',true) RETURNING id");
  const id=rows[0].id;
  assert.equal((await call('/api/audit/'+id+'/report',{method:'POST',user:3})).status,404);
  assert.equal((await call('/api/audit/'+id+'/report',{method:'POST',user:2})).status,200);
  await updateAuditLogVerification(id,{verificationStatus:'verified',verificationDetail:{},finalAnswer:'a',confidence:1});
  const row=(await pool.query('SELECT verification_status,student_reported,reviewed FROM audit_log WHERE id=$1',[id])).rows[0];
  assert.deepEqual(row,{verification_status:'flagged',student_reported:true,reviewed:false});
});

test("unavailable automatic verification never certifies an answer", async () => {
  const result=await verifyGroundedness('TCP','TCP는 무엇인가요?','TCP 설명',{provider:'default'});
  assert.equal(result.grounded,false);
  assert.equal(result.confidence,0);
});

test("unapproved questions cannot become student practice items", async () => {
  await pool.query("UPDATE exam_questions SET status='pending_review' WHERE id=1");
  await assert.rejects(()=>createAttempt({userId:2,kind:'practice_custom',questionIds:[1]}));
});

test("practice reveal locks an answer and expired attempts receive their saved score", async () => {
  const created = await createAttempt({userId:2,kind:'practice_custom',questionIds:[1]});
  const attempt = await getAttempt(created.attemptId);
  const order = attempt!.choice_order![1] as number[];
  const selected = order.indexOf(0);
  await submitAnswer({attemptId:created.attemptId,userId:2,questionId:1,selectedDisplayIndex:selected,reveal:true});
  await assert.rejects(()=>submitAnswer({attemptId:created.attemptId,userId:2,questionId:1,selectedDisplayIndex:(selected+1)%4}));
  await pool.query("UPDATE exam_attempts SET time_limit_minutes=1, started_at=now()-interval '2 minutes' WHERE id=$1",[created.attemptId]);
  await autoSubmitIfExpired(created.attemptId);
  const finished = await getAttempt(created.attemptId);
  assert.equal(finished!.status,'auto_submitted');
  assert.equal(Number(finished!.score),100);
});
