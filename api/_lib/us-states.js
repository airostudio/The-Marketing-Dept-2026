/**
 * api/_lib/us-states.js — the 50 US states plus DC, alphabetical by name.
 *
 * This is the traversal order for api/cron-sales-intel-sweep.js: "reach out
 * to 100-150 businesses per day... going in alphabetical order for each
 * state." Deliberately just states, not a bundled state→county→town
 * hierarchy — see the module comment in cron-sales-intel-sweep.js for why
 * county/town drill-down is done live against the Places API instead of a
 * hand-typed reference dataset.
 */

'use strict';

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

module.exports = { US_STATES };
