/**
 * api/_lib/autopilot/schedule.js — when an autopilot runs next: on chosen
 * weekdays at a chosen hour in the business's own time zone.
 *
 * cadence: { days: [0-6] (0 = Sunday), hour: 0-23, timezone: IANA name }
 */

'use strict';

function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }

function cleanCadence(c) {
  const src = (c && typeof c === 'object') ? c : {};
  const days = [...new Set((Array.isArray(src.days) ? src.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const hour = Number.isInteger(Number(src.hour)) ? Math.max(0, Math.min(23, Number(src.hour))) : 9;
  const timezone = typeof src.timezone === 'string' && validTz(src.timezone) ? src.timezone : 'UTC';
  return { days: days.length ? days : [2], hour, timezone };
}

/** Wall-clock parts of an instant in a time zone. */
function partsIn(date, timezone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const o = {}; for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}

/** The UTC instant of a wall-clock time in a zone (DST-aware, by correction). */
function zonedToUtc(y, m, d, h, timezone) {
  let guess = Date.UTC(y, m - 1, d, h, 0, 0);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timezone);
    const asIf = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, 0);
    guess += Date.UTC(y, m - 1, d, h, 0, 0) - asIf;
  }
  return new Date(guess);
}

/** The next run strictly after `from`. */
function nextRunAt(cadence, from = new Date()) {
  const c = cleanCadence(cadence);
  const start = partsIn(from, c.timezone);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const wd = day.getUTCDay();
    if (!c.days.includes(wd)) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), c.hour, c.timezone);
    if (at > from) return at;
  }
  return new Date(from.getTime() + 7 * 86400000);
}

module.exports = { nextRunAt, cleanCadence, partsIn };
