/**
 * ContentQuality — quality metrics for generated content, computed from the
 * content itself.
 *
 * ── What this replaced, and why ──────────────────────────────────────────
 * The previous implementation (calculateQualityMetrics in
 * content-writer-service.js) reported four precise-looking percentages that
 * were substantially predetermined:
 *
 *   Tone Match   started at 70, +30 if the text lacked "hey"/"gonna" for a
 *                professional tone, else +15. It could only ever be 85 or
 *                100 — a two-keyword test presented as a compliance figure.
 *   Style Guide  started at 75 and only ever consulted average sentence
 *                length: 75, 90 or 100. It checked none of the actual rules
 *                in the selected style guide, despite those rules being
 *                right there in the module (oxford_comma, avoid_passive_voice,
 *                avoid_contractions, max_sentence_length).
 *   SEO          started at 50, so empty content scored 50/100.
 *   Quality      averaged the four, and so could never fall below ~53
 *                however bad the writing was.
 *
 * A client reading "Tone Match 100%" would reasonably believe their content
 * had been analysed against the requested tone. It had not.
 *
 * ── The rule this module follows ─────────────────────────────────────────
 * Every score is earned from something measured in the text, and any
 * dimension that cannot honestly be measured returns `null` — never a
 * plausible-looking default. `null` renders as "—" with a reason attached.
 * Every metric also carries `checks`: what was actually examined and what it
 * found, so a number can always be interrogated rather than merely believed.
 */
window.ContentQuality = (function () {
  'use strict';

  /* ── Text primitives ──────────────────────────────────────────────────── */

  function sentencesOf(text) {
    return String(text || '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && /[a-z0-9]/i.test(s));
  }

  function wordsOf(text) {
    return String(text || '').trim().split(/\s+/).filter(w => /[a-z0-9]/i.test(w));
  }

  function syllablesIn(word) {
    const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function paragraphsOf(text) {
    return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  }

  /* ── Readability: the real Flesch Reading Ease ────────────────────────── */

  function readability(text) {
    const sentences = sentencesOf(text);
    const words = wordsOf(text);
    if (sentences.length === 0 || words.length < 20) {
      return {
        value: null,
        reason: `Too little text to score (${words.length} words). Flesch Reading Ease needs a few sentences to mean anything.`,
        checks: [],
      };
    }
    const syllables = words.reduce((n, w) => n + syllablesIn(w), 0);
    const wps = words.length / sentences.length;
    const spw = syllables / words.length;
    const raw = 206.835 - 1.015 * wps - 84.6 * spw;
    const value = Math.round(Math.max(0, Math.min(100, raw)));
    return {
      value,
      checks: [
        `${words.length} words across ${sentences.length} sentences (${wps.toFixed(1)} words/sentence)`,
        `${spw.toFixed(2)} syllables per word`,
        `Flesch Reading Ease ${value} — ${fleschBand(value)}`,
      ],
    };
  }

  function fleschBand(v) {
    if (v >= 80) return 'very easy to read';
    if (v >= 60) return 'plain English';
    if (v >= 50) return 'fairly hard';
    if (v >= 30) return 'difficult';
    return 'very difficult';
  }

  /* ── SEO: earned from zero ────────────────────────────────────────────── */

  function seo(text, opts) {
    opts = opts || {};
    const words = wordsOf(text);
    if (!words.length) {
      return { value: null, reason: 'No content to assess.', checks: [] };
    }

    const checks = [];
    let score = 0;

    // Length. Nothing is awarded for simply existing.
    if (words.length >= 1200)      { score += 30; checks.push(`${words.length} words — long-form depth (+30)`); }
    else if (words.length >= 600)  { score += 25; checks.push(`${words.length} words — solid length (+25)`); }
    else if (words.length >= 300)  { score += 15; checks.push(`${words.length} words — adequate (+15)`); }
    else                           { checks.push(`${words.length} words — short for a ranking page (+0)`); }

    const headings = (text.match(/^#{1,6}\s+\S/gm) || []).length;
    if (headings >= 3)      { score += 20; checks.push(`${headings} headings (+20)`); }
    else if (headings >= 1) { score += 10; checks.push(`${headings} heading${headings === 1 ? '' : 's'} (+10)`); }
    else                    { checks.push('No markdown headings found (+0)'); }

    const listItems = (text.match(/^\s*([-*+•]|\d+\.)\s+\S/gm) || []).length;
    if (listItems >= 3) { score += 10; checks.push(`${listItems} list items — scannable (+10)`); }
    else                { checks.push('Little or no list structure (+0)'); }

    const links = (text.match(/\[[^\]]+\]\([^)]+\)|https?:\/\/\S+/g) || []).length;
    if (links >= 2)      { score += 15; checks.push(`${links} links (+15)`); }
    else if (links === 1) { score += 8; checks.push('1 link (+8)'); }
    else                  { checks.push('No links (+0)'); }

    // Keyword presence, only when a keyword was actually supplied.
    const kw = (opts.keyword || '').trim().toLowerCase();
    if (kw) {
      const hay = text.toLowerCase();
      const count = hay.split(kw).length - 1;
      const density = count / Math.max(1, words.length);
      if (count === 0)            { checks.push(`Target keyword "${kw}" does not appear (+0)`); }
      else if (density > 0.03)    { score += 8;  checks.push(`"${kw}" appears ${count}× — density ${(density * 100).toFixed(1)}%, likely over-stuffed (+8)`); }
      else                        { score += 25; checks.push(`"${kw}" appears ${count}× — density ${(density * 100).toFixed(1)}% (+25)`); }
    } else {
      checks.push('No target keyword supplied, so keyword use was not assessed');
    }

    // Normalise against what was assessable, so not supplying a keyword
    // doesn't silently cap the score.
    const max = kw ? 100 : 75;
    return {
      value: Math.round(Math.min(100, (score / max) * 100)),
      checks,
    };
  }

  /* ── Style guide: check the guide's actual rules ──────────────────────── */

  /**
   * @param {object} rules the selected guide's rules object
   */
  /**
   * Rule checks can only ever FAIL — they detect passive voice, over-long
   * sentences, contractions. On a scrap of text there is nothing to violate,
   * so every rule passes and the piece scores 100% "compliant". That is a
   * vacuous pass dressed as a result, so anything below this many words is
   * declined instead.
   */
  const MIN_WORDS_FOR_RULE_CHECKS = 40;

  function styleGuide(text, rules) {
    rules = rules || {};
    const sentences = sentencesOf(text);
    const words = wordsOf(text);
    if (!words.length) return { value: null, reason: 'No content to assess.', checks: [] };
    if (words.length < MIN_WORDS_FOR_RULE_CHECKS) {
      return {
        value: null,
        reason: `Only ${words.length} words — too short for style-guide compliance to mean anything. ` +
                `These rules can only be broken, so a scrap of text would pass them all and score 100%.`,
        checks: [],
      };
    }

    const checks = [];
    const results = [];   // one boolean per rule actually checked

    if (rules.max_sentence_length) {
      const limit = rules.max_sentence_length;
      const over = sentences.filter(s => wordsOf(s).length > limit);
      const pass = over.length === 0;
      results.push(pass);
      checks.push(over.length
        ? `${over.length} of ${sentences.length} sentences exceed ${limit} words — FAIL`
        : `All ${sentences.length} sentences within ${limit} words — pass`);
    }

    if (rules.avoid_passive_voice || rules.active_voice_preferred) {
      const passive = (text.match(/\b(?:was|were|is|are|been|being|be)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b/gi) || []);
      const pass = passive.length === 0;
      results.push(pass);
      checks.push(passive.length
        ? `${passive.length} likely passive construction(s), e.g. "${passive[0]}" — FAIL`
        : 'No obvious passive constructions — pass');
    }

    if (rules.avoid_contractions) {
      const contractions = (text.match(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi) || []);
      const pass = contractions.length === 0;
      results.push(pass);
      checks.push(contractions.length
        ? `${contractions.length} contraction(s), e.g. "${contractions[0]}" — FAIL`
        : 'No contractions — pass');
    }

    if (rules.oxford_comma === true) {
      // "a, b and c" without the serial comma.
      const missing = (text.match(/\w+,\s+\w[\w\s]*?\s+(?:and|or)\s+\w/gi) || [])
        .filter(m => !/,\s+(?:and|or)\s/i.test(m));
      const pass = missing.length === 0;
      results.push(pass);
      checks.push(missing.length
        ? `${missing.length} list(s) appear to omit the Oxford comma — FAIL`
        : 'No missing Oxford commas detected — pass');
    }

    if (rules.paragraph_max_sentences) {
      const limit = rules.paragraph_max_sentences;
      const over = paragraphsOf(text).filter(p => sentencesOf(p).length > limit);
      const pass = over.length === 0;
      results.push(pass);
      checks.push(over.length
        ? `${over.length} paragraph(s) longer than ${limit} sentences — FAIL`
        : `All paragraphs within ${limit} sentences — pass`);
    }

    // A guide whose rules are editorial rather than machine-checkable
    // ("brand_voice: consistent", "terminology: approved_only") cannot be
    // scored here. Say so instead of emitting a number.
    if (!results.length) {
      return {
        value: null,
        reason: 'This style guide\'s rules are editorial rather than mechanical, so they cannot be checked automatically. A human needs to read it against the guide.',
        checks: Object.keys(rules).length
          ? ['Rules present but not machine-checkable: ' + Object.keys(rules).join(', ')]
          : ['No rules defined for this guide.'],
      };
    }

    const passed = results.filter(Boolean).length;
    return { value: Math.round((passed / results.length) * 100), checks };
  }

  /* ── Tone ─────────────────────────────────────────────────────────────── */

  const TONE_SIGNALS = {
    professional: {
      against: [/\bhey\b/i, /\bgonna\b/i, /\bwanna\b/i, /\bkinda\b/i, /\bstuff\b/i, /!{2,}/],
      forName: 'informal markers',
    },
    casual: {
      // A casual piece that never addresses the reader isn't casual.
      requires: [/\byou\b/i, /\byour\b/i, /\bwe\b/i],
      forName: 'direct address',
    },
    friendly: {
      requires: [/\byou\b/i, /\byour\b/i],
      against: [/\bheretofore\b/i, /\baforementioned\b/i, /\bpursuant\b/i],
      forName: 'reader-facing language',
    },
    informative: {
      against: [/\bamazing\b/i, /\bincredible\b/i, /\bgame[- ]changer\b/i, /\brevolutionary\b/i],
      forName: 'hype words',
    },
    authoritative: {
      against: [/\bmaybe\b/i, /\bprobably\b/i, /\bsort of\b/i, /\bkind of\b/i, /\bI think\b/i],
      forName: 'hedging',
    },
  };

  function tone(text, requested) {
    const words = wordsOf(text);
    if (!words.length) return { value: null, reason: 'No content to assess.', checks: [] };
    // Same vacuous-pass problem as the style rules: a handful of words
    // contains no informal markers and would score a perfect tone match.
    if (words.length < MIN_WORDS_FOR_RULE_CHECKS) {
      return {
        value: null,
        reason: `Only ${words.length} words — too short to judge tone. A scrap of text contains no ` +
                `tone markers either way, so it would score 100% without anything being demonstrated.`,
        checks: [],
      };
    }

    const spec = TONE_SIGNALS[String(requested || '').toLowerCase()];
    if (!spec) {
      // Being honest about the limit is the whole point: we have no signal
      // set for this tone, so we do not pretend to have measured it.
      return {
        value: null,
        reason: `No automatic check exists for a "${requested || 'unspecified'}" tone, so this was not assessed.`,
        checks: [],
      };
    }

    const checks = [];
    const results = [];

    (spec.against || []).forEach(re => {
      const hits = text.match(new RegExp(re.source, 'gi')) || [];
      results.push(hits.length === 0);
      if (hits.length) checks.push(`Found ${spec.forName}: "${hits[0]}" (${hits.length}×) — counts against`);
    });

    (spec.requires || []).forEach(re => {
      const hits = text.match(new RegExp(re.source, 'gi')) || [];
      results.push(hits.length > 0);
      if (!hits.length) checks.push(`Expected ${spec.forName} matching ${re} — not found`);
    });

    if (!checks.length) checks.push(`No ${spec.forName} issues found for a "${requested}" tone.`);

    const passed = results.filter(Boolean).length;
    return {
      value: results.length ? Math.round((passed / results.length) * 100) : null,
      checks,
      note: 'A keyword-level signal, not a judgement of voice. Read it before trusting it.',
    };
  }

  /* ── Overall ──────────────────────────────────────────────────────────── */

  /**
   * Averages only what was actually measured. A dimension that returned null
   * is excluded rather than folded in as a number, so the headline figure
   * never gets propped up by a dimension nobody assessed.
   */
  function overall(parts) {
    const measured = Object.values(parts).filter(p => p && typeof p.value === 'number');
    if (!measured.length) return { value: null, measuredCount: 0, totalCount: Object.keys(parts).length };
    const sum = measured.reduce((n, p) => n + p.value, 0);
    return {
      value: Math.round(sum / measured.length),
      measuredCount: measured.length,
      totalCount: Object.keys(parts).length,
    };
  }

  /**
   * @param {string} text
   * @param {{tone?: string, styleGuideRules?: object, keyword?: string}} opts
   */
  function analyse(text, opts) {
    opts = opts || {};
    const parts = {
      readability: readability(text),
      seo: seo(text, { keyword: opts.keyword }),
      style: styleGuide(text, opts.styleGuideRules),
      tone: tone(text, opts.tone),
    };
    return Object.assign({}, parts, { overall: overall(parts) });
  }

  return {
    analyse, readability, seo, styleGuide, tone, overall,
    // exported for tests
    _internal: { sentencesOf, wordsOf, syllablesIn, paragraphsOf },
  };
})();
