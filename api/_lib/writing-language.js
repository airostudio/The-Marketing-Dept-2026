/**
 * writing-language.js — the languages / English variants a business can
 * choose in its Business Brain, and the instruction every writing agent is
 * given for the one it chose.
 *
 * One list, used in the browser (Business Brain select, agent prompts) and on
 * the server (Pat's and Nancy's drafting prompts). The server copy lives in
 * api/_lib/writing-language.js; tests/writing-language checks the two are
 * identical, so they cannot drift.
 */
(function (root) {
  'use strict';

  // code → [label, instruction]
  const LANGUAGES = {
    'en-US': ['English (US)', 'American English — US spelling (color, organize, center), US vocabulary and date style (month/day/year)'],
    'en-GB': ['English (UK)', 'British English — UK spelling (colour, organise, centre), UK vocabulary and date style (day/month/year)'],
    'en-AU': ['English (Australia)', 'Australian English — Australian/UK spelling (colour, organise, centre), Australian vocabulary and date style (day/month/year)'],
    'en-NZ': ['English (New Zealand)', 'New Zealand English — NZ/UK spelling (colour, organise, centre), NZ vocabulary and date style (day/month/year)'],
    'en-CA': ['English (Canada)', 'Canadian English — Canadian spelling (colour, centre, but organize/-ize), Canadian vocabulary'],
    'en-IE': ['English (Ireland)', 'Irish English — UK spelling (colour, organise, centre), Irish vocabulary and date style (day/month/year)'],
    'en-ZA': ['English (South Africa)', 'South African English — UK spelling (colour, organise, centre), South African vocabulary'],
    'en-IN': ['English (India)', 'Indian English — UK spelling (colour, organise, centre), Indian vocabulary'],
    'es':    ['Spanish', 'Spanish (neutral international Spanish)'],
    'fr':    ['French', 'French'],
    'de':    ['German', 'German'],
    'pt-BR': ['Portuguese (Brazil)', 'Brazilian Portuguese'],
    'pt-PT': ['Portuguese (Portugal)', 'European Portuguese'],
    'it':    ['Italian', 'Italian'],
    'nl':    ['Dutch', 'Dutch'],
  };

  function isSupported(code) { return Object.prototype.hasOwnProperty.call(LANGUAGES, code); }

  function list() { return Object.keys(LANGUAGES).map(code => ({ code, label: LANGUAGES[code][0] })); }

  /**
   * The line added to a writing prompt. Returns '' for an unset or unknown
   * code, so nothing is assumed on a business's behalf — callers keep their
   * own default.
   */
  function directive(code) {
    if (!isSupported(code)) return '';
    const [label, how] = LANGUAGES[code];
    return `WRITING LANGUAGE: write all customer-facing copy in ${how}. Spell every word correctly for ${label}; never mix variants. Proper nouns, brand names and quoted text stay as they are.`;
  }

  const api = { LANGUAGES, isSupported, list, directive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WritingLanguage = api;
})(typeof window !== 'undefined' ? window : globalThis);
