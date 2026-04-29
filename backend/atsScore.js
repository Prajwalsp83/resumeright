// ─── ATS Score (heuristic) ─────────────────────────────────────────────────
// Free, instant resume scan that doubles as a lead magnet.
//
// Why heuristic-first: zero LLM cost per scan, deterministic results, and
// the rules below (sections, length, contact, quantified achievements,
// formatting hygiene) catch ~80% of what real ATS parsers + recruiters
// flag in the first pass. Paid users get an LLM-augmented deep scan
// later — that's the upsell.
//
// Input  : { text, jobDescription? }
// Output : { score, grade, issues, strengths, stats, breakdown }
// ───────────────────────────────────────────────────────────────────────────

const SECTION_PATTERNS = {
  contact:    /\b(email|phone|mobile|linkedin|github)\b/i,
  summary:    /\b(summary|objective|profile|about\s*me)\b/i,
  experience: /\b(experience|employment|work\s*history|professional\s*experience)\b/i,
  education:  /\b(education|academic|qualification)\b/i,
  skills:     /\b(skills|technical\s*skills|core\s*competenc|technologies)\b/i,
  projects:   /\b(projects?|portfolio)\b/i,
};

const ACTION_VERBS = [
  'led','built','launched','shipped','designed','architected','owned','drove',
  'reduced','increased','improved','grew','accelerated','optimized','automated',
  'delivered','migrated','scaled','founded','managed','mentored','negotiated',
  'developed','created','implemented','engineered','spearheaded','transformed',
  'streamlined','generated','achieved','executed','established','introduced',
];

const WEAK_BUZZWORDS = [
  'team player','hardworking','hard working','self-motivated','self motivated',
  'detail-oriented','detail oriented','results-driven','results driven',
  'go-getter','synergy','rockstar','ninja','guru','passionate','dynamic',
  'thinks outside the box','team-player',
];

const PERSONAL_PRONOUNS = /\b(i|me|my|mine|myself)\b/gi;

// Common stopwords to ignore when extracting JD keywords.
const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','in','on','at','to','for','with','by',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','this','that',
  'these','those','it','its','as','from','if','then','than','so','not','no',
  'we','our','you','your','they','their','he','she','his','her','about','also',
  'who','what','when','where','why','how','any','all','some','such','more',
  'most','other','into','out','over','under','up','down','off','one','two',
  'role','team','work','working','years','year','experience','candidate','must',
  'should','required','requirements','preferred','plus','etc','strong','good',
  'great','ability','skills','skill','knowledge','understanding','familiar',
  'using','used','use','well','best','new','high','low','across',
]);

// ───────────────────────────────────────────────────────────────────────────
// Scoring engine
// ───────────────────────────────────────────────────────────────────────────
function scoreResume({ text, jobDescription = '' } = {}) {
  const raw = (text || '').replace(/\u0000/g, '').trim();
  if (!raw) {
    return {
      score: 0, grade: 'F',
      issues: [{ severity: 'critical', message: 'Could not extract any text from this PDF. Most likely it is a scanned image. ATS systems cannot read it.' }],
      strengths: [],
      stats: { wordCount: 0, charCount: 0 },
      breakdown: {},
    };
  }

  const lower = raw.toLowerCase();
  const words = raw.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const charCount = raw.length;
  const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);

  const issues = [];
  const strengths = [];

  // ── Sections ────────────────────────────────────────────────────────────
  const sections = {};
  for (const [key, pattern] of Object.entries(SECTION_PATTERNS)) {
    sections[key] = pattern.test(raw);
  }
  const missingSections = [];
  if (!sections.experience)  missingSections.push('Experience');
  if (!sections.education)   missingSections.push('Education');
  if (!sections.skills)      missingSections.push('Skills');
  if (!sections.summary)     missingSections.push('Summary / Objective');

  // ── Contact ─────────────────────────────────────────────────────────────
  const hasEmail    = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(raw);
  const hasPhone    = /(\+?\d[\d\s\-()]{7,}\d)/.test(raw);
  const hasLinkedIn = /linkedin\.com\/in\//i.test(raw);
  const hasGithub   = /github\.com\//i.test(raw);

  // ── Length ──────────────────────────────────────────────────────────────
  // ATS-friendly resumes typically run 350–900 words for 1–2 pages.
  const tooShort = wordCount < 250;
  const tooLong  = wordCount > 1100;

  // ── Quantified achievements ─────────────────────────────────────────────
  // Numbers + % + ₹/$ are the strongest signal of a results-oriented resume.
  // Combine three permissive patterns and dedupe by string match.
  const quantHits = new Set();
  const patterns = [
    /\b\d+(?:[,.]\d+)?\s*%/g,                                            // 35%, 12.5%
    /[₹$€£]\s*\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|cr|crore|lakh|lpa|million|billion)?/gi, // ₹2Cr, $1.2M
    /\b\d+(?:[,.]\d+)?\s*(?:k|m|b|cr|crore|lakh|lpa|million|billion|x)\b/gi,        // 2M, 500K, 5x
    /\b\d+\s*(?:ms|seconds?|sec|mins?|minutes?|hours?|hrs?|days?|weeks?|months?|years?|yrs?)\b/gi,                                                                  // 120ms, 8 weeks
    /\b\d+\s*(?:users?|customers?|clients?|orders?|leads?|sales?|requests?|queries|events?|reqs?|rps|qps|reviews?|posts?|articles?|projects?|teams?|members?|employees?|engineers?|people|hires?|interviews?|sessions?|signups?|installs?|downloads?|subscribers?|countries|cities|states|stores|outlets|partners?|vendors?|deals?)\b/gi,
    /\b(?:team|group|squad|crew)\s+of\s+\d+\b/gi,                        // team of 5
    /\b\d{3,}\b/g,                                                       // any standalone 3+ digit number (likely meaningful)
  ];
  for (const re of patterns) {
    const found = raw.match(re) || [];
    found.forEach(f => quantHits.add(f.toLowerCase().trim()));
  }
  const quantifiedCount = quantHits.size;

  // ── Action verbs ────────────────────────────────────────────────────────
  const actionVerbHits = ACTION_VERBS.filter(v => new RegExp(`\\b${v}\\b`, 'i').test(raw)).length;

  // ── Weak buzzwords ──────────────────────────────────────────────────────
  const weakBuzzwords = WEAK_BUZZWORDS.filter(b => lower.includes(b));

  // ── Personal pronouns (resumes shouldn't use "I") ───────────────────────
  const pronounHits = (raw.match(PERSONAL_PRONOUNS) || []).length;

  // ── ALL CAPS overuse ─────────────────────────────────────────────────────
  // Only count *sentence-length* lines (>30 chars). Short lines like
  // "EXPERIENCE" or "SKILLS" are normal section headings and shouldn't
  // be penalized. We're after sentence-level shouting only.
  const sentenceLines = lines.filter(l => l.length > 30);
  const capsLines = sentenceLines.filter(l => l === l.toUpperCase() && /[A-Z]/.test(l));
  const capsRatio = sentenceLines.length ? capsLines.length / sentenceLines.length : 0;

  // ── JD keyword match (when provided) ────────────────────────────────────
  let keywordMatch = null;
  if (jobDescription && jobDescription.trim().length > 30) {
    const jdKeywords = extractKeywords(jobDescription, 25);
    const matched = jdKeywords.filter(kw => new RegExp(`\\b${escapeRe(kw)}\\b`, 'i').test(raw));
    keywordMatch = {
      total:   jdKeywords.length,
      matched: matched.length,
      percent: jdKeywords.length ? Math.round((matched.length / jdKeywords.length) * 100) : 0,
      missing: jdKeywords.filter(kw => !matched.includes(kw)).slice(0, 12),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Score breakdown — out of 100
  // ─────────────────────────────────────────────────────────────────────────
  const breakdown = {
    parseability: 20,   // can ATS read it
    sections:     20,   // standard structure
    contact:      10,   // reachable
    impact:       20,   // quantified achievements + action verbs
    length:       10,   // right size
    formatting:   10,   // no caps spam, weak buzzwords, pronouns
    keywords:     10,   // JD match (or evenly distributed if no JD)
  };

  // Parseability — text was extracted, give full marks unless it looks garbled
  const garbledRatio = (raw.match(/[^\x20-\x7E\n\r]/g) || []).length / charCount;
  if (garbledRatio > 0.05) {
    breakdown.parseability -= 10;
    issues.push({ severity: 'critical', message: 'Resume contains many non-standard characters — this often means the PDF is image-based or has unusual fonts that ATS systems cannot parse.' });
  } else {
    strengths.push('PDF text extracts cleanly — ATS-readable format.');
  }

  // Sections
  const presentSections = Object.values(sections).filter(Boolean).length;
  breakdown.sections = Math.round((presentSections / 6) * 20);
  if (missingSections.length) {
    issues.push({
      severity: missingSections.length >= 2 ? 'high' : 'medium',
      message:  `Missing ${missingSections.length} standard section(s): ${missingSections.join(', ')}. ATS systems look for these by name.`,
    });
  } else {
    strengths.push('All standard resume sections present (Experience, Education, Skills, Summary).');
  }

  // Contact
  let contactScore = 0;
  if (hasEmail)    contactScore += 4;
  if (hasPhone)    contactScore += 3;
  if (hasLinkedIn) contactScore += 2;
  if (hasGithub)   contactScore += 1;
  breakdown.contact = contactScore;
  if (!hasEmail) issues.push({ severity: 'critical', message: 'No email address detected. Recruiters cannot reach you.' });
  if (!hasPhone) issues.push({ severity: 'high',     message: 'No phone number detected. Add one near the top of the resume.' });
  if (!hasLinkedIn) issues.push({ severity: 'medium', message: 'No LinkedIn URL detected. ~95% of recruiters cross-check on LinkedIn.' });
  if (hasEmail && hasPhone && hasLinkedIn) strengths.push('Strong contact block — email, phone, and LinkedIn all present.');

  // Impact (quantified + action verbs)
  let impact = 0;
  if (quantifiedCount >= 8)      impact += 12;
  else if (quantifiedCount >= 4) impact += 8;
  else if (quantifiedCount >= 2) impact += 4;
  else                            issues.push({ severity: 'high', message: 'Almost no quantified achievements detected. Add numbers — "increased X by 40%", "managed ₹2Cr budget", "team of 8". This is the #1 thing recruiters scan for.' });

  if (actionVerbHits >= 8)      impact += 8;
  else if (actionVerbHits >= 4) impact += 5;
  else                            issues.push({ severity: 'medium', message: 'Few strong action verbs. Start bullets with "Led", "Built", "Reduced", "Launched" instead of "Responsible for" or "Worked on".' });
  breakdown.impact = Math.min(impact, 20);
  if (quantifiedCount >= 5 && actionVerbHits >= 6) {
    strengths.push(`Strong impact language — ${quantifiedCount} quantified results and ${actionVerbHits} strong action verbs.`);
  }

  // Length
  if (tooShort) {
    breakdown.length = 4;
    issues.push({ severity: 'high', message: `Resume is too short (${wordCount} words). Aim for 350–900 words covering at least one full page.` });
  } else if (tooLong) {
    breakdown.length = 5;
    issues.push({ severity: 'medium', message: `Resume is too long (${wordCount} words). For most roles, keep it to 1–2 pages — under 1000 words.` });
  } else {
    breakdown.length = 10;
    strengths.push(`Length is well-tuned (${wordCount} words, ~${Math.max(1, Math.round(wordCount / 450))} page${wordCount > 600 ? 's' : ''}).`);
  }

  // Formatting hygiene
  let fmt = 10;
  if (capsRatio > 0.15) {
    fmt -= 4;
    issues.push({ severity: 'medium', message: 'Too many ALL-CAPS lines. Use Title Case for section headings — caps spam looks unprofessional.' });
  }
  if (weakBuzzwords.length >= 2) {
    fmt -= 3;
    issues.push({ severity: 'medium', message: `Generic buzzwords detected: "${weakBuzzwords.slice(0, 4).join('", "')}". Replace with concrete, measurable accomplishments.` });
  }
  if (pronounHits >= 5) {
    fmt -= 2;
    issues.push({ severity: 'low', message: 'Avoid first-person pronouns ("I", "my"). Resumes use implicit subject — "Led team of 5" not "I led a team of 5".' });
  }
  breakdown.formatting = Math.max(0, fmt);

  // Keywords (JD match)
  if (keywordMatch) {
    breakdown.keywords = Math.round((keywordMatch.percent / 100) * 10);
    if (keywordMatch.percent < 40) {
      issues.push({
        severity: 'high',
        message: `Only ${keywordMatch.percent}% match with the job description. Missing keywords: ${keywordMatch.missing.slice(0, 6).join(', ')}.`,
      });
    } else if (keywordMatch.percent >= 70) {
      strengths.push(`Strong keyword match (${keywordMatch.percent}%) with the target job description.`);
    }
  } else {
    // No JD provided — give a baseline 6/10 instead of 0; can't penalize what we can't measure.
    breakdown.keywords = 6;
  }

  // ─── Final score ────────────────────────────────────────────────────────
  const score = Math.min(100, Math.max(0,
    breakdown.parseability +
    breakdown.sections +
    breakdown.contact +
    breakdown.impact +
    breakdown.length +
    breakdown.formatting +
    breakdown.keywords
  ));

  const grade =
    score >= 90 ? 'A+' :
    score >= 80 ? 'A'  :
    score >= 70 ? 'B'  :
    score >= 60 ? 'C'  :
    score >= 50 ? 'D'  : 'F';

  // Sort issues by severity for clean display
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    score,
    grade,
    issues,
    strengths,
    stats: {
      wordCount,
      charCount,
      sections,
      quantifiedCount,
      actionVerbHits,
      hasEmail, hasPhone, hasLinkedIn, hasGithub,
    },
    breakdown,
    keywordMatch,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
function extractKeywords(text, limit = 25) {
  const counts = new Map();
  const tokens = text.toLowerCase().match(/[a-z][a-z+#.\-]{2,}/g) || [];
  for (const t of tokens) {
    if (STOPWORDS.has(t) || t.length < 3) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { scoreResume };
