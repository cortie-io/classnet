import { execSync } from 'node:child_process';
import { simulateTokenBurn } from './src/admin/tokenBurn.ts';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error('DATABASE_URL is missing');
}

const studentNames = String(execSync(`psql "${dbUrl}" -Atqc "SELECT name FROM users WHERE role = 'student' ORDER BY id;"`, { stdio: ['ignore', 'pipe', 'pipe'] })).trim().split(/\r?\n/).filter(Boolean);
if (!studentNames.length) {
  throw new Error('No student rows found');
}

const totalTokens = 889592;

const apiCaller = async (prompt: string, apiKey: string, model: string) => {
  const student = prompt.match(/^\[([^\]]+)\]/)?.[1] ?? 'unknown';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`openai chat failed: ${response.status} ${text}`);
  }

  const json = await response.json() as any;
  const usage = json?.usage ?? {};
  const used = Number(usage.total_tokens ?? json?.total_tokens ?? 0);
  console.log(`[${new Date().toISOString()}] student=${student} used=${Number.isFinite(used) ? used : 0} model=${model}`);
  return json;
};

const result = await simulateTokenBurn(studentNames, totalTokens, {
  tokensPerTurn: 2000,
  rankMethod: 'linear',
  apiKey: process.env.OPENAI_API_KEY,
  apiModel: 'gpt-4o-mini',
  promptText: '학생 질문에 대해 짧고 정확하게 답하세요.',
  apiCaller,
});

console.log('\n=== FINAL SUMMARY ===');
console.log(JSON.stringify({
  studentCount: result.studentOrder.length,
  totalTokens: result.totalTokens,
  apiCalls: result.apiCalls,
  usingApi: result.usingApi,
  remainingTotal: result.log.at(-1)?.remainingTotal ?? null,
  allocations: Object.fromEntries(Object.entries(result.allocations).map(([name, value]) => [name, { quota: value.quota, consumed: value.consumed, remaining: value.remaining }])),
  lastFive: result.log.slice(-5),
}, null, 2));
