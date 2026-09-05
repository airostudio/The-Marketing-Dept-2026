/**
 * agent-characters.js
 * Pop-art character portraits for every Audema marketing agent.
 * Add data-agent="rex" (or any agent ID below) to any .hero element to activate.
 * The script auto-initialises on DOMContentLoaded.
 */
(function () {
  'use strict';

  var SK = '#f5c4a0'; // skin
  var H  = '#2a1500'; // dark hair
  var O  = '#0a0a0a'; // outline

  // ── Hair builders ──────────────────────────────────────────────────────────

  function wavyHair() {
    return '<path d="M 43,62 Q 52,28 80,26 Q 108,28 117,62 Q 108,40 80,38 Q 52,40 43,62 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 44,60 C 38,74 37,92 44,102" stroke="' + H + '" stroke-width="14" fill="none" stroke-linecap="round"/>' +
           '<path d="M 116,60 C 122,74 123,92 116,102" stroke="' + H + '" stroke-width="14" fill="none" stroke-linecap="round"/>';
  }

  function spikyHair() {
    return '<path d="M 43,62 Q 52,28 80,26 Q 108,28 117,62 Q 108,40 80,38 Q 52,40 43,62 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2"/>' +
           '<polygon points="60,41 55,11 70,38" fill="' + H + '" stroke="' + O + '" stroke-width="1.5"/>' +
           '<polygon points="77,37 74,9 88,35" fill="' + H + '" stroke="' + O + '" stroke-width="1.5"/>' +
           '<polygon points="93,41 92,12 105,38" fill="' + H + '" stroke="' + O + '" stroke-width="1.5"/>';
  }

  function wavyLongHair(tint) {
    var hc = tint || H;
    return '<path d="M 43,62 Q 52,28 80,26 Q 108,28 117,62 Q 108,40 80,38 Q 52,40 43,62 Z" fill="' + hc + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 43,62 C 36,80 33,110 36,132 C 38,144 44,152 44,164" stroke="' + hc + '" stroke-width="16" fill="none" stroke-linecap="round"/>' +
           '<path d="M 117,62 C 124,80 127,110 124,132 C 122,144 116,152 116,164" stroke="' + hc + '" stroke-width="16" fill="none" stroke-linecap="round"/>';
  }

  function shortTopHair() {
    return '<path d="M 47,62 Q 55,36 80,34 Q 105,36 113,62 Q 105,46 80,44 Q 55,46 47,62 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>';
  }

  function sweptHair() {
    return '<path d="M 43,62 Q 52,28 80,26 Q 108,28 117,62 Q 110,42 90,38 Q 60,35 43,62 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 117,62 C 122,72 122,86 116,96" stroke="' + H + '" stroke-width="12" fill="none" stroke-linecap="round"/>';
  }

  function partedHair() {
    return '<path d="M 43,56 Q 54,26 80,26 Q 108,28 117,58 Q 108,40 80,38 Q 62,36 43,56 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 43,56 C 38,68 38,82 44,92" stroke="' + H + '" stroke-width="14" fill="none" stroke-linecap="round"/>' +
           '<path d="M 117,58 C 122,70 121,82 116,92" stroke="' + H + '" stroke-width="8" fill="none" stroke-linecap="round"/>';
  }

  function neatHair() {
    return '<path d="M 46,60 Q 54,30 80,28 Q 106,30 114,60 Q 106,42 80,40 Q 54,42 46,60 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 46,60 C 42,72 42,84 46,92" stroke="' + H + '" stroke-width="10" fill="none" stroke-linecap="round"/>' +
           '<path d="M 114,60 C 118,72 118,84 114,92" stroke="' + H + '" stroke-width="10" fill="none" stroke-linecap="round"/>';
  }

  function bunHair() {
    return '<path d="M 47,64 Q 55,36 80,34 Q 105,36 113,64 Q 105,46 80,44 Q 55,46 47,64 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 47,64 C 42,74 42,86 46,94" stroke="' + H + '" stroke-width="10" fill="none" stroke-linecap="round"/>' +
           '<path d="M 113,64 C 118,74 118,86 114,94" stroke="' + H + '" stroke-width="10" fill="none" stroke-linecap="round"/>' +
           '<circle cx="80" cy="28" r="14" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 66,36 Q 80,26 94,36" stroke="' + O + '" stroke-width="1.5" fill="none"/>';
  }

  function upsweepHair() {
    return '<path d="M 43,62 Q 52,28 80,26 Q 108,28 117,62 Q 108,40 80,38 Q 52,40 43,62 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 70,38 Q 92,16 118,20" stroke="' + H + '" stroke-width="12" fill="none" stroke-linecap="round"/>' +
           '<path d="M 43,62 C 38,74 38,88 44,98" stroke="' + H + '" stroke-width="12" fill="none" stroke-linecap="round"/>';
  }

  function shortNeatHair() {
    return '<path d="M 50,65 Q 57,35 80,33 Q 103,35 110,65 Q 103,48 80,46 Q 57,48 50,65 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 50,65 C 46,74 46,84 50,92" stroke="' + H + '" stroke-width="8" fill="none" stroke-linecap="round"/>' +
           '<path d="M 110,65 C 114,74 114,84 110,92" stroke="' + H + '" stroke-width="8" fill="none" stroke-linecap="round"/>';
  }

  function artisticHair() {
    return '<path d="M 43,62 Q 52,28 80,26 Q 108,28 117,62 Q 108,40 80,38 Q 52,40 43,62 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 43,62 C 36,74 34,92 38,112" stroke="' + H + '" stroke-width="15" fill="none" stroke-linecap="round"/>' +
           '<path d="M 117,62 C 124,74 126,92 122,112" stroke="' + H + '" stroke-width="15" fill="none" stroke-linecap="round"/>' +
           '<path d="M 95,32 Q 110,14 118,20" stroke="' + H + '" stroke-width="5" fill="none" stroke-linecap="round"/>';
  }

  function filmHair() {
    return '<path d="M 43,62 Q 52,28 80,26 Q 108,28 117,62 Q 108,40 80,38 Q 52,40 43,62 Z" fill="' + H + '" stroke="' + O + '" stroke-width="2.5"/>' +
           '<path d="M 43,62 C 38,74 37,92 44,104" stroke="' + H + '" stroke-width="13" fill="none" stroke-linecap="round"/>' +
           '<path d="M 117,62 C 122,74 123,92 116,104" stroke="' + H + '" stroke-width="13" fill="none" stroke-linecap="round"/>' +
           '<path d="M 60,36 Q 70,24 80,26" stroke="' + H + '" stroke-width="4" fill="none" stroke-linecap="round"/>';
  }

  // ── Accessories ────────────────────────────────────────────────────────────

  function toRgb(hex) {
    return parseInt(hex.slice(1,3),16) + ',' + parseInt(hex.slice(3,5),16) + ',' + parseInt(hex.slice(5,7),16);
  }

  function roundGlasses(c) {
    return '<circle cx="65" cy="71" r="13" fill="rgba(' + toRgb(c) + ',0.15)" stroke="' + O + '" stroke-width="2.5"/>' +
           '<circle cx="95" cy="71" r="13" fill="rgba(' + toRgb(c) + ',0.15)" stroke="' + O + '" stroke-width="2.5"/>' +
           '<line x1="78" y1="71" x2="82" y2="71" stroke="' + O + '" stroke-width="2.5"/>' +
           '<line x1="40" y1="68" x2="52" y2="71" stroke="' + O + '" stroke-width="2"/>' +
           '<line x1="108" y1="71" x2="120" y2="68" stroke="' + O + '" stroke-width="2"/>';
  }

  function rectGlasses(c) {
    return '<rect x="51" y="62" width="26" height="17" rx="3" fill="rgba(' + toRgb(c) + ',0.18)" stroke="' + O + '" stroke-width="2.5"/>' +
           '<rect x="83" y="62" width="26" height="17" rx="3" fill="rgba(' + toRgb(c) + ',0.18)" stroke="' + O + '" stroke-width="2.5"/>' +
           '<line x1="77" y1="70" x2="83" y2="70" stroke="' + O + '" stroke-width="2.5"/>' +
           '<line x1="36" y1="68" x2="51" y2="70" stroke="' + O + '" stroke-width="2"/>' +
           '<line x1="109" y1="70" x2="124" y2="68" stroke="' + O + '" stroke-width="2"/>';
  }

  function headphones(c) {
    return '<path d="M 43,70 Q 43,30 80,30 Q 117,30 117,70" fill="none" stroke="' + c + '" stroke-width="6" stroke-linecap="round"/>' +
           '<rect x="35" y="65" width="14" height="20" rx="7" fill="' + c + '" stroke="' + O + '" stroke-width="2"/>' +
           '<rect x="111" y="65" width="14" height="20" rx="7" fill="' + c + '" stroke="' + O + '" stroke-width="2"/>';
  }

  function pencilBehindEar() {
    return '<g transform="rotate(-18 117 68)">' +
           '<rect x="113" y="50" width="7" height="28" rx="2" fill="#f5d050" stroke="' + O + '" stroke-width="1.5"/>' +
           '<polygon points="113,50 120,50 116.5,42" fill="' + SK + '" stroke="' + O + '" stroke-width="1"/>' +
           '<rect x="113" y="76" width="7" height="5" fill="#b0a090" stroke="' + O + '" stroke-width="1"/>' +
           '</g>';
  }

  function tieDetail(c) {
    return '<path d="M 76,117 L 80,133 L 84,117 L 82,121 L 80,129 L 78,121 Z" fill="' + c + '" stroke="' + O + '" stroke-width="1.5"/>';
  }

  function binoculars(c) {
    return '<circle cx="66" cy="142" r="14" fill="rgba(0,0,0,0.7)" stroke="' + c + '" stroke-width="2.5"/>' +
           '<circle cx="66" cy="142" r="8" fill="rgba(' + toRgb(c) + ',0.2)" stroke="' + c + '" stroke-width="1.5"/>' +
           '<circle cx="94" cy="142" r="14" fill="rgba(0,0,0,0.7)" stroke="' + c + '" stroke-width="2.5"/>' +
           '<circle cx="94" cy="142" r="8" fill="rgba(' + toRgb(c) + ',0.2)" stroke="' + c + '" stroke-width="1.5"/>' +
           '<rect x="77" y="138" width="6" height="8" rx="2" fill="' + c + '" stroke="' + O + '" stroke-width="1"/>';
  }

  function shieldBadge(c) {
    return '<path d="M 71,130 L 80,124 L 89,130 L 89,148 Q 80,156 71,148 Z" fill="' + c + '" stroke="' + O + '" stroke-width="2"/>' +
           '<path d="M 76,136 L 79,143 L 85,133" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  function lockBadge(c) {
    return '<rect x="70" y="136" width="20" height="16" rx="3" fill="' + c + '" stroke="' + O + '" stroke-width="2"/>' +
           '<path d="M 75,136 Q 75,128 80,128 Q 85,128 85,136" fill="none" stroke="' + c + '" stroke-width="2.5"/>' +
           '<circle cx="80" cy="143" r="3" fill="white"/>';
  }

  function laserPointer(c) {
    return '<g transform="rotate(28 122 112)">' +
           '<rect x="118" y="98" width="8" height="30" rx="4" fill="#888" stroke="' + O + '" stroke-width="1.5"/>' +
           '<circle cx="122" cy="96" r="4" fill="' + c + '"/>' +
           '</g>';
  }

  function filmClapper(c) {
    return '<rect x="58" y="128" width="44" height="28" rx="4" fill="rgba(0,0,0,0.7)" stroke="' + c + '" stroke-width="2"/>' +
           '<rect x="58" y="128" width="44" height="10" rx="3" fill="' + c + '" stroke="' + O + '" stroke-width="1.5"/>' +
           '<line x1="67" y1="128" x2="64" y2="118" stroke="' + c + '" stroke-width="2"/>' +
           '<line x1="78" y1="128" x2="75" y2="118" stroke="' + c + '" stroke-width="2"/>' +
           '<line x1="89" y1="128" x2="86" y2="118" stroke="' + c + '" stroke-width="2"/>';
  }

  function starEarring() {
    return '<circle cx="113" cy="82" r="5" fill="#ffd700" stroke="' + O + '" stroke-width="1.5"/>' +
           '<path d="M 110,79 L 113,73 L 116,79 L 122,80 L 117,85 L 119,91 L 113,88 L 107,91 L 109,85 L 104,80 Z" fill="#ffd700" stroke="' + O + '" stroke-width="1" transform="scale(0.55) translate(89 70)"/>';
  }

  // ── Mouth constants ────────────────────────────────────────────────────────

  var SMILE   = '<path d="M 68,88 Q 80,97 92,88" fill="none" stroke="#c07840" stroke-width="2.5" stroke-linecap="round"/>';
  var WIDE    = '<path d="M 63,87 Q 80,100 97,87" fill="none" stroke="#c07840" stroke-width="3" stroke-linecap="round"/>';
  var WARM    = '<path d="M 67,89 Q 80,99 93,89" fill="none" stroke="#c07840" stroke-width="2.5" stroke-linecap="round"/>';
  var GRIN    = '<path d="M 63,87 Q 80,100 97,87 Q 80,96 63,87 Z" fill="white" stroke="' + O + '" stroke-width="2"/>';
  var SERIOUS = '<path d="M 70,89 Q 80,93 90,89" fill="none" stroke="#c07840" stroke-width="2" stroke-linecap="round"/>';
  var FOCUSED = '<path d="M 69,88 Q 80,95 91,88" fill="none" stroke="#c07840" stroke-width="2" stroke-linecap="round"/>';
  var PRESENT = '<path d="M 65,87 Q 80,99 95,87" fill="none" stroke="#c07840" stroke-width="2.5" stroke-linecap="round"/>';

  // ── SVG assembler ──────────────────────────────────────────────────────────

  function buildSVG(color, hair, accessory, mouth) {
    return [
      '<circle cx="80" cy="95" r="76" fill="' + color + '" opacity="0.09"/>',
      // Shirt with shoulder wings
      '<path d="M 8,190 Q 8,148 50,120 L 80,116 L 110,120 Q 152,148 152,190 Z" fill="' + color + '" stroke="' + O + '" stroke-width="3"/>',
      // Collar notch
      '<path d="M 68,116 L 80,128 L 92,116" fill="' + color + '" stroke="' + O + '" stroke-width="1.5"/>',
      // Neck
      '<rect x="67" y="108" width="26" height="18" rx="4" fill="' + SK + '" stroke="' + O + '" stroke-width="2.5"/>',
      // Head
      '<ellipse cx="80" cy="72" rx="37" ry="41" fill="' + SK + '" stroke="' + O + '" stroke-width="3"/>',
      // Hair
      hair,
      // Eyes
      '<circle cx="65" cy="71" r="5" fill="#1a0800"/>',
      '<circle cx="95" cy="71" r="5" fill="#1a0800"/>',
      '<circle cx="67" cy="69" r="2" fill="white"/>',
      '<circle cx="97" cy="69" r="2" fill="white"/>',
      // Nose
      '<path d="M 77,80 Q 80,85 83,80" fill="none" stroke="#c07840" stroke-width="1.5" stroke-linecap="round"/>',
      // Mouth
      mouth,
      // Accessory (on top)
      accessory || ''
    ].join('');
  }

  // ── Agent roster ───────────────────────────────────────────────────────────

  var AGENTS = {
    rex: {
      name: 'REX', color: '#06b6d4',
      tagline: 'Obsessive researcher. Turns search chaos into rankings dominance.',
      svg: function(c) { return buildSVG(c, wavyHair(), roundGlasses(c), SMILE); }
    },
    nova: {
      name: 'NOVA', color: '#ec4899',
      tagline: 'Relationship-builder. Turns cold lists into loyal audiences.',
      svg: function(c) { return buildSVG(c, wavyLongHair('#3d1220'), starEarring(), WARM); }
    },
    pulse: {
      name: 'PULSE', color: '#8b5cf6',
      tagline: 'Trend-chaser. Culturally fluent, always one beat ahead.',
      svg: function(c) { return buildSVG(c, shortTopHair(), headphones(c), GRIN); }
    },
    ink: {
      name: 'INK', color: '#6366f1',
      tagline: 'Thoughtful craftsperson. Words that earn attention and build belief.',
      svg: function(c) { return buildSVG(c, sweptHair(), pencilBehindEar(), FOCUSED); }
    },
    chase: {
      name: 'CHASE', color: '#10b981',
      tagline: 'Relentless closer. Pipeline builder who makes every word count.',
      svg: function(c) { return buildSVG(c, partedHair(), '', WIDE); }
    },
    mex: {
      name: 'MEX', color: '#3b82f6',
      tagline: 'Strategic networker. Turns connections into career-defining conversations.',
      svg: function(c) { return buildSVG(c, neatHair(), tieDetail(c), SMILE); }
    },
    vera: {
      name: 'VERA', color: '#f59e0b',
      tagline: 'Pattern-seeker. Transforms raw numbers into decisions that move revenue.',
      svg: function(c) { return buildSVG(c, bunHair(), rectGlasses(c), FOCUSED); }
    },
    lift: {
      name: 'LIFT', color: '#ef4444',
      tagline: 'Conversion fanatic. Tests everything, assumes nothing, ships faster.',
      svg: function(c) { return buildSVG(c, upsweepHair(), '', GRIN); }
    },
    scout: {
      name: 'SCOUT', color: '#14b8a6',
      tagline: 'Always watching. Finds competitive gaps before they become threats.',
      svg: function(c) { return buildSVG(c, shortNeatHair(), binoculars(c), FOCUSED); }
    },
    shield: {
      name: 'SHIELD', color: '#64748b',
      tagline: 'Detail-first guardian. Keeps your brand safe and legally sound.',
      svg: function(c) { return buildSVG(c, shortNeatHair(), shieldBadge(c), SERIOUS); }
    },
    lock: {
      name: 'LOCK', color: '#475569',
      tagline: 'Compliance autopilot. Closes enterprise deals with audit-ready evidence.',
      svg: function(c) { return buildSVG(c, shortNeatHair(), lockBadge(c), SERIOUS); }
    },
    slate: {
      name: 'SLATE', color: '#7c3aed',
      tagline: 'Visual storyteller. Makes complex ideas land in one slide.',
      svg: function(c) { return buildSVG(c, artisticHair(), laserPointer(c), PRESENT); }
    },
    reel: {
      name: 'REEL', color: '#06b6d4',
      tagline: 'Script-to-screen specialist. Every frame purposeful, every hook magnetic.',
      svg: function(c) { return buildSVG(c, filmHair(), filmClapper(c), PRESENT); }
    },
    nancy: {
      name: 'NANCY', color: '#e53e3e',
      tagline: 'Instagram obsessed. One URL and a photo becomes a researched, on-brand week of content.',
      svg: function(c) { return buildSVG(c, spikyHair(), '', GRIN); }
    },
    carol: {
      name: 'CAROL', color: '#d946ef',
      tagline: 'Chief of Staff. Turns fifteen agents\' worth of findings into the one briefing you actually read.',
      svg: function(c) { return buildSVG(c, neatHair(), '', FOCUSED); }
    }
  };

  // Real portrait images
  var AGENT_IMGS = {
    rex:    '/assets/agents/rex.png',
    nova:   '/assets/agents/nova.png',
    reel:   '/assets/agents/reel.png',
    pulse:  '/assets/agents/pulse.png',
    ink:    '/assets/agents/ink.png',
    mex:    '/assets/agents/mex.png',
    vera:   '/assets/agents/vera.png',
    scout:  '/assets/agents/scout.png',
    shield: '/assets/agents/shield.png',
    lock:   '/assets/agents/lock.png',
    chase:  '/assets/agents/chase.png',
    lift:   '/assets/agents/lift.png',
    slate:  '/assets/agents/slate.png',
    nancy:  '/assets/agents/nancy.png',
    carol:  '/assets/agents/carol.png'
  };

  // Per-agent photo adjustments (zoom/position for characters that sit small in frame)
  var AGENT_PHOTO_STYLE = {};

  // Attach img path to each agent that has one
  Object.keys(AGENT_IMGS).forEach(function(id) {
    if (AGENTS[id]) AGENTS[id].img = AGENT_IMGS[id];
  });

  // Export for external use (e.g. hub card rendering)
  window.AgentCharacters = AGENTS;

  // ── Hero injection ─────────────────────────────────────────────────────────

  window.initAgentHero = function (agentId) {
    var hero = document.querySelector('[data-agent]');
    if (!hero) return;
    var agent = AGENTS[agentId];
    if (!agent) return;

    var color = agent.color;

    // Build character frame — real image if available, SVG fallback
    var frame = document.createElement('div');
    frame.className = 'char-frame';

    if (agent.img) {
      var img = document.createElement('img');
      img.src = agent.img;
      img.alt = agent.name;
      img.className = 'char-photo';
      if (AGENT_PHOTO_STYLE[agentId]) img.style.cssText += AGENT_PHOTO_STYLE[agentId];
      // On error fall back to SVG
      img.onerror = function() {
        this.outerHTML = '<svg viewBox="0 0 160 190" xmlns="http://www.w3.org/2000/svg">' + agent.svg(color) + '</svg>';
      };
      frame.appendChild(img);
    } else {
      frame.innerHTML = '<svg viewBox="0 0 160 190" xmlns="http://www.w3.org/2000/svg">' + agent.svg(color) + '</svg>';
    }

    // Wrap existing hero children into hero-body
    var body = document.createElement('div');
    body.className = 'hero-body';
    while (hero.firstChild) body.appendChild(hero.firstChild);

    // Remove old emoji
    var emoji = body.querySelector('.hero-emoji');
    if (emoji) emoji.remove();

    // Insert codename before the main heading
    var heading = body.querySelector('h1, h2, .hero-title');
    if (heading) {
      var codename = document.createElement('span');
      codename.className = 'agent-codename';
      codename.textContent = agent.name;
      codename.style.color = color;
      body.insertBefore(codename, heading);
    }

    // Rebuild hero: portrait left, content right
    hero.appendChild(frame);
    hero.appendChild(body);

    // Apply flex layout (overrides inline CSS)
    hero.style.cssText += ';display:flex!important;align-items:center;justify-content:center;gap:40px;text-align:left;padding:40px 32px 36px;';

    // Fix child text alignment
    [heading, body.querySelector('.hero-tagline')].forEach(function(el) {
      if (el) { el.style.textAlign = 'left'; el.style.maxWidth = ''; el.style.margin = ''; }
    });
    var pills = body.querySelector('.hero-pills');
    if (pills) pills.style.justifyContent = 'flex-start';

    // Inject shared CSS once per page
    if (!document.getElementById('agent-hero-style')) {
      var style = document.createElement('style');
      style.id = 'agent-hero-style';
      style.textContent =
        '.char-frame{flex-shrink:0;position:relative}' +
        '.char-frame svg{width:132px;height:157px;display:block;filter:drop-shadow(0 10px 30px ' + color + '70)}' +
        '.char-photo{width:160px;height:200px;object-fit:cover;object-position:center top;border-radius:12px;display:block;' +
          'box-shadow:0 12px 40px ' + color + '50,0 0 0 1px ' + color + '30}' +
        '.hero-body{flex:1;min-width:0}' +
        '.agent-codename{display:block;font-size:10px;font-weight:900;letter-spacing:5px;text-transform:uppercase;margin-bottom:10px;opacity:0.85}' +
        '@media(max-width:680px){' +
          '.char-frame svg{width:104px;height:124px}' +
          '.char-photo{width:120px;height:150px}' +
          '[data-agent]{flex-direction:column!important;text-align:center!important;padding:28px 20px 24px!important;gap:16px!important}' +
          '[data-agent] h1,[data-agent] .hero-title,[data-agent] .hero-tagline{text-align:center!important;margin-left:0!important}' +
          '[data-agent] .hero-pills{justify-content:center!important}' +
        '}';
      document.head.appendChild(style);
    }
  };

  // ── Auto-init from data-agent attribute ────────────────────────────────────

  function autoInit() {
    var el = document.querySelector('[data-agent]');
    if (el) {
      var id = el.getAttribute('data-agent');
      if (id && AGENTS[id]) window.initAgentHero(id);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

}());
