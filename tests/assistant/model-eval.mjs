// Phase 11: repeatable evaluation of local models for the AI assistant (AI_ASSISTANT.md §Model choice).
//
// Runs every case of eval-cases.json against each model on Ollama, through the same path the assistant uses:
// the system prompt of the role (services/mcp-client-service/src/main/resources/assistant/prompts), the tool schemas
// of the role exactly as mcp-server-service lists them (tools.json), Ollama /api/chat with tools and the same options
// (temperature, num_ctx, think off). Tool calls get canned results from the case (no live data), so every run sees
// the same data. Measures: tool choice, arguments, answer content, grounding (same rules as GroundingGuard.java),
// time to the first answer token and total time on this CPU, prompt and generation speed, and memory.
//
// Usage (repo root, Ollama running, e.g. the compose "ollama" service on localhost:11434):
//   node tests/assistant/model-eval.mjs --models qwen3:4b-instruct,granite4.1:3b [--cases c1,a2] [--ollama URL]
//   node tests/assistant/model-eval.mjs --snapshot-tools     (refresh tools.json from the running stack)
// Results: tests/assistant/results/<timestamp>.json and a Markdown table on stdout.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--')
  ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null).filter(Boolean));
const OLLAMA = args.ollama ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
const NUM_CTX = Number(args['num-ctx'] ?? 8192);
const TEMPERATURE = Number(args.temperature ?? 0.2);
const PROMPTS = here('../../services/mcp-client-service/src/main/resources/assistant/prompts/');
const ROLE_FILES = { CUSTOMER: 'customer', ADMIN: 'admin', HOTEL_MANAGER: 'hotel-manager', SUPPORT_AGENT: 'support' };
const ROLE_ORDER = ['CUSTOMER', 'ADMIN', 'HOTEL_MANAGER', 'SUPPORT_AGENT'];
/** Look-up tools a model may call before the decisive one, with their canned results (not scored). */
const HELPERS = {
  HOTEL_MANAGER: { my_hotels: { hotels: [{ name: 'Sea Breeze Resort', city: 'Goa', status: 'ACTIVE', starRating: 4 }] } },
};

// ---------------------------------------------------------------- system prompt (same files as SystemPrompts.java)
function systemPrompt(role, today = new Date()) {
  const read = (name) => readFileSync(PROMPTS + name + '.txt', 'utf8').trim();
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(today);
  const long = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric',
    month: 'long', year: 'numeric' }).format(today).replace(',', '');
  return read('intro').replace('{today}', long).replace('{isoDate}', iso) + '\n' + read(ROLE_FILES[role]) + '\n'
    + read('rules');
}

// ---------------------------------------------------------------- grounding check (port of GroundingGuard.java)
const REFERENCE = /(?<![A-Za-z0-9-])[A-Z]{2}-[A-Z0-9]{8}(?![A-Za-z0-9-])/g;
const CODE = /(?<![A-Za-z0-9-])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,12}(?![A-Za-z0-9-])/g;
const LABELLED_PNR = /PNR\W{0,15}([A-Z0-9]{6})(?![A-Za-z0-9])/g;
const E_TICKET = /(?<![0-9-])(\d{3})-?(\d{10})(?![0-9])/g;
const AMOUNT_PREFIX = /(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)/g;
const AMOUNT_SUFFIX = /(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s?(?:INR|rupees|Rs\b)/gi;
const ANY_NUMBER = /(?<![\d.])\d[\d,]*(?:\.\d+)?/g;
/** Same as GroundingGuard.normalise: typographic hyphens, spaces and full-width digits read as plain ones. */
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
  .replace(/[\u00A0\u2007\u202F\u2009\u200A]/g, ' ').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  .replace(/[\u2018\u2019]/g, "'");
const canonical = (n) => { const v = Number(n.replace(/,/g, '').replace(/\.$/, '')); return Number.isFinite(v) ? String(v) : null; };
function idsInAnswer(answer) {
  const ids = new Set();
  for (const re of [REFERENCE, CODE]) for (const m of answer.matchAll(re)) ids.add(m[0].toUpperCase());
  for (const m of answer.matchAll(LABELLED_PNR)) ids.add(m[1].toUpperCase());
  for (const m of answer.matchAll(E_TICKET)) ids.add(m[1] + m[2]);
  return ids;
}
/** Facts = tool results (identifiers and numbers) + identifiers the user typed (Facts.addIdentifiersFromUser). */
function factsOf(sources, userText = '') {
  const ids = new Set(idsInAnswer(norm(userText))); const amounts = new Set();
  for (const text of sources.map(norm)) {
    for (const m of text.matchAll(REFERENCE)) ids.add(m[0]);
    let prev = null; let prevEnd = -10;
    for (const m of text.matchAll(/[A-Z0-9]+/g)) {
      ids.add(m[0]);
      if (prev && m.index - prevEnd <= 1) ids.add(prev + m[0]);
      prev = m[0]; prevEnd = m.index + m[0].length;
    }
    for (const m of text.matchAll(E_TICKET)) ids.add(m[1] + m[2]);
    for (const m of text.matchAll(ANY_NUMBER)) { const c = canonical(m[0]); if (c) amounts.add(c); }
  }
  return { ids, amounts };
}
function groundingViolation(rawAnswer, facts) {
  const answer = norm(rawAnswer);
  for (const id of idsInAnswer(answer)) if (!facts.ids.has(id)) return `identifier ${id}`;
  for (const re of [AMOUNT_PREFIX, AMOUNT_SUFFIX]) {
    for (const m of answer.matchAll(re)) { const c = canonical(m[1]); if (c && !facts.amounts.has(c)) return `amount ${m[0]}`; }
  }
  return null;
}

// ---------------------------------------------------------------- Ollama
async function ollama(path, body) {
  const res = await fetch(OLLAMA + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/** One streamed /api/chat call: content, tool calls, time to first content token, total time, Ollama's counters. */
async function chatOnce(model, messages, tools, think) {
  const start = performance.now();
  const res = await fetch(OLLAMA + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, stream: true, keep_alive: '30m', ...(think ? { think: false } : {}),
      options: { temperature: TEMPERATURE, num_ctx: NUM_CTX, num_predict: 600 } }) });
  if (!res.ok) throw new Error(`chat -> ${res.status} ${await res.text()}`);
  const decoder = new TextDecoder();
  let buffer = ''; let content = ''; let firstToken = null; const toolCalls = []; let stats = {};
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const data = JSON.parse(line);
      if (data.error) throw new Error(data.error);
      const piece = data.message?.content ?? '';
      if (piece && firstToken === null && piece.trim()) firstToken = performance.now() - start;
      content += piece;
      for (const call of data.message?.tool_calls ?? []) toolCalls.push(call);
      if (data.done) stats = data;
    }
  }
  return { content, toolCalls, firstToken, total: performance.now() - start, stats };
}

// ---------------------------------------------------------------- scoring
function matchValue(actual, spec) {
  if (Array.isArray(spec)) return spec.some((s) => matchValue(actual, s));
  if (spec === null) return actual === undefined || actual === null;
  if (spec && typeof spec === 'object' && spec.regex) return actual != null && new RegExp(spec.regex, 'i').test(String(actual));
  if (typeof spec === 'boolean') return actual === spec || String(actual).toLowerCase() === String(spec);
  return actual != null && String(actual).trim().toLowerCase() === String(spec).toLowerCase();
}
function argsOk(testCase, call, toolsByName) {
  const props = toolsByName[call.function.name]?.inputSchema?.properties ?? {};
  const actual = call.function.arguments ?? {};
  return Object.entries(testCase.args ?? {}).filter(([key]) => key in props)
    .every(([key, spec]) => matchValue(actual[key], spec));
}
const contains = (text, s) => norm(text).toLowerCase().includes(norm(s).toLowerCase());

async function runCase(model, testCase, tools, think) {
  const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const ollamaTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description,
    parameters: t.inputSchema } }));
  const messages = [{ role: 'system', content: systemPrompt(testCase.role) }, { role: 'user', content: testCase.prompt }];
  const start = performance.now();
  const rounds = []; const toolResults = []; let firstCall = null; let answer = ''; let firstAnswerToken = null;
  const helpers = new Set([...(testCase.helpers ?? []), ...Object.keys(HELPERS[testCase.role] ?? {})]);
  for (let round = 0; round < 3; round++) {
    const r = await chatOnce(model, messages, ollamaTools, think);
    rounds.push({ promptTokens: r.stats.prompt_eval_count, promptMs: (r.stats.prompt_eval_duration ?? 0) / 1e6,
      evalTokens: r.stats.eval_count, evalMs: (r.stats.eval_duration ?? 0) / 1e6, loadMs: (r.stats.load_duration ?? 0) / 1e6,
      totalMs: r.total, tools: r.toolCalls.map((c) => c.function.name),
      calls: r.toolCalls.map((c) => ({ name: c.function.name, arguments: c.function.arguments })) });
    if (r.toolCalls.length === 0 || round === 2) {
      answer = r.content.trim();
      if (r.firstToken !== null) firstAnswerToken = (performance.now() - start) - (r.total - r.firstToken);
      break;
    }
    // The decisive call: the first one that is not a look-up helper (e.g. my_hotels before a hotel tool).
    firstCall ??= r.toolCalls.find((c) => !helpers.has(c.function.name)) ?? null;
    messages.push({ role: 'assistant', content: r.content, tool_calls: r.toolCalls });
    for (const call of r.toolCalls) {
      const fixture = testCase.results?.[call.function.name] ?? HELPERS[testCase.role]?.[call.function.name];
      const text = JSON.stringify(fixture ?? { error: 'NOT_FOUND', message: 'Nothing was found, or you are not allowed to see it.' });
      toolResults.push(text);
      messages.push({ role: 'tool', content: text, tool_name: call.function.name });
    }
  }
  const total = performance.now() - start;
  const expectedTools = testCase.tools ?? [];
  const okTools = [...expectedTools, ...(testCase.alsoOk ?? [])];
  const toolOk = firstCall ? okTools.includes(firstCall.function.name) : expectedTools.length === 0;
  const argOk = firstCall ? toolOk && argsOk(testCase, firstCall, toolsByName) : expectedTools.length === 0;
  const expectOk = (testCase.expect ?? []).every((group) => group.some((alt) => contains(answer, alt)));
  const forbidOk = !(testCase.forbid ?? []).some((s) => contains(answer, s));
  const violation = groundingViolation(answer, factsOf(toolResults, testCase.prompt));
  return { id: testCase.id, role: testCase.role, tool: firstCall?.function.name ?? null,
    args: firstCall?.function.arguments ?? null, toolOk, argsOk: argOk, answerOk: expectOk && forbidOk && answer.length > 0,
    grounded: violation === null, violation, answer, firstTokenMs: firstAnswerToken, totalMs: total, rounds };
}

const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const pct = (xs, f) => `${Math.round(100 * xs.filter(f).length / xs.length)}%`;
const sec = (ms) => (ms == null ? '-' : (ms / 1000).toFixed(1));

function memoryOf(model) {
  try {
    const usage = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', 'flight-hotel-ollama-1'],
      { encoding: 'utf8' }).trim();
    return usage.split('/')[0].trim();
  } catch { return '?'; }
}

async function evaluate(model, cases, allTools) {
  const show = await ollama('/api/show', { model });
  const capabilities = show.capabilities ?? [];
  if (!capabilities.includes('tools')) return { model, skipped: 'no tool calling' };
  const think = capabilities.includes('thinking');
  const loadStart = performance.now();
  await ollama('/api/generate', { model, keep_alive: '30m', options: { num_ctx: NUM_CTX } });
  const loadMs = performance.now() - loadStart;
  const results = [];
  for (const role of ROLE_ORDER) {
    let first = true;
    for (const testCase of cases.filter((c) => c.role === role)) {
      process.stdout.write(`  ${model} ${testCase.id} ... `);
      let result;
      try { result = await runCase(model, testCase, allTools[role], think); } catch (e) {
        result = { id: testCase.id, role, error: e.message, toolOk: false, argsOk: false, answerOk: false, grounded: false };
      }
      result.coldForRole = first; first = false;
      results.push(result);
      console.log(`${result.toolOk ? 'tool ok' : 'TOOL ' + result.tool} ${result.argsOk ? 'args ok' : 'ARGS'} `
        + `${result.answerOk ? 'answer ok' : 'ANSWER'} ${result.grounded ? '' : 'UNGROUNDED(' + result.violation + ') '}`
        + `${sec(result.firstTokenMs)}s/${sec(result.totalMs)}s`);
    }
  }
  const ps = await ollama('/api/ps');
  const loaded = (ps.models ?? []).find((m) => m.name === model || m.model === model);
  const memory = memoryOf(model);
  await ollama('/api/generate', { model, keep_alive: 0 });
  return summarize({ model, size: loaded ? `${(loaded.size / 2 ** 30).toFixed(1)} GiB` : '?', memory, loadMs, think,
    results });
}

/** The aggregate figures of one model's run. */
function summarize(run) {
  const results = run.results;
  const warm = results.filter((r) => !r.coldForRole && !r.error);
  const allRounds = results.flatMap((r) => r.rounds ?? []);
  const promptRate = allRounds.reduce((a, r) => a + (r.promptTokens ?? 0), 0)
    / Math.max(1, allRounds.reduce((a, r) => a + r.promptMs, 0) / 1000);
  const genRate = allRounds.reduce((a, r) => a + (r.evalTokens ?? 0), 0)
    / Math.max(1, allRounds.reduce((a, r) => a + r.evalMs, 0) / 1000);
  return { ...run,
    toolChoice: pct(results, (r) => r.toolOk), args: pct(results, (r) => r.argsOk), answers: pct(results, (r) => r.answerOk),
    grounded: pct(results, (r) => r.grounded), errors: results.filter((r) => r.error).length,
    medianFirstTokenWarm: median(warm.map((r) => r.firstTokenMs)), medianTotalWarm: median(warm.map((r) => r.totalMs)),
    medianTotalColdRole: median(results.filter((r) => r.coldForRole).map((r) => r.totalMs)),
    promptTokensPerSecond: Math.round(promptRate), generatedTokensPerSecond: Math.round(genRate * 10) / 10,
    maxPromptTokens: Math.max(...allRounds.map((r) => r.promptTokens ?? 0)) };
}

/** Recomputes answer and grounding scores of saved results with the current cases and rules (tool results are the fixtures). */
function rescore(run, cases) {
  const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
  const results = run.results.map((r) => {
    const testCase = byId[r.id];
    if (!testCase || r.error) return r;
    const toolResults = (r.rounds ?? []).flatMap((round) => round.tools).map((name) => JSON.stringify(
      testCase.results?.[name] ?? HELPERS[testCase.role]?.[name]
      ?? { error: 'NOT_FOUND', message: 'Nothing was found, or you are not allowed to see it.' }));
    const expectOk = (testCase.expect ?? []).every((group) => group.some((alt) => contains(r.answer, alt)));
    const forbidOk = !(testCase.forbid ?? []).some((s) => contains(r.answer, s));
    const violation = groundingViolation(r.answer, factsOf(toolResults, testCase.prompt));
    return { ...r, answerOk: expectOk && forbidOk && r.answer.length > 0, grounded: violation === null, violation };
  });
  return summarize({ ...run, results });
}

function printTable(runs) {
  console.log(`
| Model | Loaded size | Container RAM | Tool choice | Arguments | Answer | Grounded | First token (warm, median) | Total (warm, median) | Total (first per role) | Prompt tok/s | Gen tok/s |`);
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    if (r.error || r.skipped) { console.log(`| ${r.model} | ${r.error ?? r.skipped} |||||||||||`); continue; }
    console.log(`| ${r.model} | ${r.size} | ${r.memory} | ${r.toolChoice} | ${r.args} | ${r.answers} | ${r.grounded} | `
      + `${sec(r.medianFirstTokenWarm)} s | ${sec(r.medianTotalWarm)} s | ${sec(r.medianTotalColdRole)} s | ${r.promptTokensPerSecond} | ${r.generatedTokensPerSecond} |`);
  }
}

// ---------------------------------------------------------------- tool snapshot from the running stack
async function snapshotTools() {
  const env = Object.fromEntries(readFileSync(here('../../.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8080';
  const out = {};
  for (const [role, email] of [['CUSTOMER', 'customer'], ['ADMIN', 'admin'], ['HOTEL_MANAGER', 'manager'], ['SUPPORT_AGENT', 'support']]) {
    const login = await fetch(gateway + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${email}@flighthotel.local`, password: env.DEMO_USER_PASSWORD }) });
    const token = (await login.json()).accessToken;
    // The MCP server has no published port: ask it from inside the Docker network (through the mcp-client container).
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const raw = execFileSync('docker', ['exec', 'flight-hotel-mcp-client-service-1', 'curl', '-s', '-X', 'POST',
      'http://mcp-server-service:8109/mcp', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream',
      '-H', `X-MCP-Api-Key: ${env.MCP_SERVER_API_KEY}`, '-H', `Authorization: Bearer ${token}`, '-d', body], { encoding: 'utf8' });
    out[role] = JSON.parse(raw).result.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema }));
  }
  writeFileSync(here('./tools.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('tools.json:', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
}

// ---------------------------------------------------------------- main
const allCases = JSON.parse(readFileSync(here('./eval-cases.json'), 'utf8')).cases;
if (args['snapshot-tools']) {
  await snapshotTools();
} else if (args.rescore) {
  // node tests/assistant/model-eval.mjs --rescore results/a.json,results/b.json
  const runs = String(args.rescore).split(',').flatMap((file) => JSON.parse(readFileSync(file, 'utf8')).runs)
    .map((run) => (run.results ? rescore(run, allCases) : run));
  printTable(runs);
} else {
  const models = String(args.models ?? 'granite4:tiny-h').split(',');
  const wanted = args.cases ? new Set(String(args.cases).split(',')) : null;
  const cases = allCases.filter((c) => !wanted || wanted.has(c.id));
  const allTools = JSON.parse(readFileSync(here('./tools.json'), 'utf8'));
  const runs = [];
  mkdirSync(here('./results/'), { recursive: true });
  const file = here(`./results/eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  for (const model of models) {
    console.log(`
== ${model}`);
    try { runs.push(await evaluate(model, cases, allTools)); } catch (e) { console.log('  failed:', e.message); runs.push({ model, error: e.message }); }
    // Saved after every model, so a long run that is stopped keeps what it measured.
    writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), numCtx: NUM_CTX, temperature: TEMPERATURE, cases: cases.length, runs }, null, 1));
  }
  printTable(runs);
  console.log(`
Details: ${file}`);
}
