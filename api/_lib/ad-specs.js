/**
 * api/_lib/ad-specs.js — each ad platform's copy limits and creative guidance,
 * in one place. Used by the Ad Creative Lab generator (api/generate-ads.js) to
 * brief the model, and by a Scotty mission (api/mission-ads.js) to check that
 * what came back actually fits the platform before anyone is asked to approve it.
 */

'use strict';

// ── Platform specs (character limits + visual guidance) ────────────────────
const PLATFORM_SPECS = {
  'Meta/Facebook': {
    headline:    { max: 40,  label: 'Headline' },
    body:        { max: 125, label: 'Primary Text (mobile truncates at 125)' },
    description: { max: 30,  label: 'Link Description' },
    cta_options: ['Learn More','Shop Now','Sign Up','Get Quote','Download','Watch More','Contact Us'],
    format:      'Image/Video + copy. Hook visible before "see more" fold at 125 chars. Emoji welcome.',
    visual:      'Stop-scroll creative: bold contrast, faces/emotions, single focus object on clean background.',
  },
  'LinkedIn': {
    headline:  { max: 70,  label: 'Headline' },
    body:      { max: 150, label: 'Introductory Text (first 150 chars shown before "more")' },
    cta_options: ['Learn More','Sign Up','Download','Get Quote','Register','Request Demo'],
    format:    'Professional tone. Job title/industry targeting. Thought leadership performs well.',
    visual:    'Professional photography, infographics, or clean stat graphics. No flashy consumer aesthetics.',
  },
  'TikTok': {
    body:      { max: 100, label: 'Ad Text' },
    cta_options: ['Learn More','Shop Now','Sign Up','Download','Contact Us'],
    format:    'Video-first. Hook in first 3 seconds. Text secondary. Trend-native, raw feel outperforms polished.',
    visual:    'Vertical 9:16 video. On-screen captions. Native UGC style beats studio production.',
  },
  'Google Search': {
    headline:     { max: 30,  label: 'Headlines (up to 15, shown 3 at a time)' },
    description:  { max: 90,  label: 'Descriptions (up to 4, shown 2 at a time)' },
    display_url:  { max: 15,  label: 'URL path (per segment)' },
    format:       'Keyword-intent matching. RSA format — pin most critical headlines to position 1/2. Use DKI sparingly.',
    visual:       'Text-only. Focus on intent match, clear benefit statement, and specific CTA.',
  },
  'Google Display': {
    headline:      { max: 30,  label: 'Short Headline' },
    long_headline: { max: 90,  label: 'Long Headline' },
    description:   { max: 90,  label: 'Description' },
    format:        'Responsive display ads — provide multiple headlines/descriptions, Google optimises. Image-forward.',
    visual:        'Clean product shot or lifestyle image, high contrast, minimal text overlay (<20% of image).',
  },
  'Twitter/X': {
    body:      { max: 280, label: 'Tweet text' },
    cta_options: ['Learn More','Shop Now','Sign Up','Book Now'],
    format:    'Conversational, direct, opinionated. Twitter-native voice. Threads for complex arguments.',
    visual:    '16:9 image or video. Muted autoplay for video ads — always caption.',
  },
  'YouTube': {
    headline:   { max: 15,  label: 'Headline (displayed below video)' },
    body:       { max: 70,  label: 'Description' },
    cta_options: ['Learn More','Shop Now','Sign Up','Get Quote','Download'],
    format:     'Skippable in-stream: hook in first 5 seconds. Non-skippable (15s) or bumper (6s). Brand recall focus.',
    visual:     'High-energy open 5s, clear brand mark early. Logo watermark throughout. Subtitle all speech.',
  },
};

module.exports = { PLATFORM_SPECS };
