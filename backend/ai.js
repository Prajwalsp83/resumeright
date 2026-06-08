// AI deep-scan — the paid (₹199) upsell layered on top of the deterministic
// heuristic scorer in atsScore.js. The heuristic stays the gate: we feed its
// result + the extracted resume text to Claude and ask for ENRICHED, grounded
// fixes (rewrites, prioritised actions, role fit) — never to contradict the
// deterministic signal.
//
// Fail-soft like notify.js / payments.js: the SDK is lazy-required and the
// whole feature is gated on ANTHROPIC_API_KEY. If either is absent the
// /tools/ats-deep-scan endpoint returns 503 and the free heuristic scan is
// completely unaffected.

const env = require('./config');

let _client = null;
let _sdkOk  = true;

const aiEnabled = Boolean(env.ANTHROPIC_API_KEY);

function client() {
  if (!aiEnabled || !_sdkOk) return null;
  if (_client) return _client;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return _client;
  } catch (e) {
    // SDK not installed yet (fresh checkout before `npm i`) — disable, don't crash.
    console.warn('⚠️  @anthropic-ai/sdk not installed — AI deep-scan disabled.');
    _sdkOk = false;
    return null;
  }
}

// Structured-output schema. Anthropic structured outputs require
// additionalProperties:false on every object and forbid min/max/length
// constraints — keep it to types + required only.
const DEEP_SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary:                  { type: 'string' },
    estimatedScoreAfterFixes: { type: 'integer' },
    roleFit:                  { type: 'string' },
    topFixes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title:  { type: 'string' },
          why:    { type: 'string' },
          action: { type: 'string' },
        },
        required: ['title', 'why', 'action'],
      },
    },
    rewrittenBullets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          before: { type: 'string' },
          after:  { type: 'string' },
        },
        required: ['before', 'after'],
      },
    },
    missingKeywords: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'summary', 'estimatedScoreAfterFixes', 'roleFit',
    'topFixes', 'rewrittenBullets', 'missingKeywords',
  ],
};

const SYSTEM = [
  'You are a senior resume writer and ATS specialist for the Indian and global job market.',
  'You are given a candidate resume and the output of a deterministic ATS heuristic.',
  'Your job is to ENRICH that heuristic with specific, actionable fixes — not to restate or contradict its score.',
  'Rules:',
  '- Ground every rewrite in the candidate\'s ACTUAL text. Never invent employers, metrics, titles, or achievements they did not state.',
  '- Rewritten bullets must start with a strong action verb and add quantification ONLY where the original implies it; if no number exists, sharpen wording instead of fabricating one.',
  '- topFixes: 3–6 prioritised, concrete changes. `action` must be a step the candidate can do today.',
  '- rewrittenBullets: 3–6 before/after pairs taken verbatim (before) from the resume, improved (after).',
  '- missingKeywords: only when a job description is supplied; otherwise return an empty array.',
  '- estimatedScoreAfterFixes: an integer 0–100, at least the current heuristic score, realistic about what the fixes achieve.',
  '- roleFit: 1–2 sentences on fit for the stated target role (or general market if none).',
  'Be direct and specific. This is a paid deliverable.',
].join('\n');

/**
 * Run the paid deep scan. Throws on failure (caller surfaces a friendly error).
 * @returns the validated object matching DEEP_SCAN_SCHEMA.
 */
async function deepScanResume({ text, heuristic, targetRole, jobDescription }) {
  const c = client();
  if (!c) throw new Error('AI deep-scan not configured');

  const userContent = [
    `TARGET ROLE: ${targetRole || '(not specified)'}`,
    '',
    'DETERMINISTIC HEURISTIC RESULT (do not contradict the score):',
    JSON.stringify({
      score:        heuristic?.score,
      grade:        heuristic?.grade,
      breakdown:    heuristic?.breakdown,
      issues:       heuristic?.issues,
      keywordMatch: heuristic?.keywordMatch || null,
    }),
    '',
    jobDescription ? `JOB DESCRIPTION:\n${jobDescription}\n` : 'JOB DESCRIPTION: (none provided)\n',
    'RESUME TEXT:',
    text || '',
  ].join('\n');

  const msg = await c.messages.create({
    model:      env.AI_MODEL,
    max_tokens: 16000,
    thinking:   { type: 'adaptive' },
    output_config: {
      effort: 'medium', // balances analysis quality against the latency a paying user waits on
      format: { type: 'json_schema', schema: DEEP_SCAN_SCHEMA },
    },
    system:   SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  // With output_config.format the first text block is guaranteed valid JSON.
  const block = (msg.content || []).find(b => b.type === 'text');
  if (!block) throw new Error('AI returned no text block');
  return JSON.parse(block.text);
}

module.exports = { aiEnabled, deepScanResume };
