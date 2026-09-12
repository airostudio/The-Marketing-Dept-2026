/**
 * agent-history.js
 * Shared module for persisting agent outputs to localStorage.
 * All agents call AgentHistory.save() in their onDone callback.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'tmd_agent_history';
  const MAX_ENTRIES = 300;

  const AGENT_META = {
    'seo':                  { name: 'SEO Intelligence',        icon: '🔍', color: '#06b6d4' },
    'content-studio':       { name: 'Content Studio',          icon: '✍️',  color: '#8b5cf6' },
    'email':                { name: 'Email Engine',            icon: '📧', color: '#10b981' },
    'social':               { name: 'Social Studio',           icon: '📱', color: '#ec4899' },
    'competitive':          { name: 'Competitive Intelligence',icon: '🎯', color: '#14b8a6' },
    'ads':                  { name: 'Ad Campaigns',            icon: '🎯', color: '#f97316' },
    'analytics':            { name: 'Analytics Brain',         icon: '📊', color: '#3b82f6' },
    'sales':                { name: 'Sales Intelligence',      icon: '💼', color: '#a855f7' },
    'video':                { name: 'Video Studio',            icon: '🎬', color: '#ef4444' },
    'cro':                  { name: 'CRO Lab',                 icon: '🔬', color: '#84cc16' },
    'compliance':           { name: 'Compliance Guard',        icon: '🛡️', color: '#64748b' },
    'compliance-automation':{ name: 'Compliance Automation',   icon: '⚙️', color: '#64748b' },
    'deck':                 { name: 'Deck Maker',              icon: '📊', color: '#f59e0b' },
    'linkedin':             { name: 'LinkedIn Prospecting',    icon: '💼', color: '#0ea5e9' },
    'carol':                { name: 'Carol — Chief of Staff',  icon: '🗂️', color: '#d946ef' },
  };

  function _read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }

  function _write(entries) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (_) {}
  }

  /**
   * Save a completed agent output.
   * @param {Object} opts
   * @param {string} opts.agentKey   - e.g. 'seo', 'email', 'content-studio'
   * @param {string} opts.taskType   - e.g. 'Keyword Research', 'Email Sequence'
   * @param {string} opts.content    - raw markdown text
   * @param {string} [opts.topic]    - URL, topic, or subject used as input
   * @param {Object} [opts.meta]     - any extra key/value pairs to store
   * @returns {Object} the saved entry
   */
  function save({ agentKey, taskType, content, topic = '', meta = {} }) {
    if (!content || !content.trim()) return null;

    const entries = _read();
    const agentInfo = AGENT_META[agentKey] || { name: agentKey, icon: '🤖', color: '#7c3aed' };

    const entry = {
      id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      agentKey,
      agentName: agentInfo.name,
      agentIcon: agentInfo.icon,
      agentColor: agentInfo.color,
      taskType:  taskType || 'Report',
      topic:     topic || '',
      content,
      wordCount: content.trim().split(/\s+/).length,
      timestamp: new Date().toISOString(),
      meta,
    };

    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    _write(entries);

    // Dispatch event so history page can react if open
    try {
      window.dispatchEvent(new CustomEvent('agentHistory:saved', { detail: entry }));
    } catch (_) {}

    return entry;
  }

  function getAll()             { return _read(); }
  function getByAgent(key)      { return _read().filter(e => e.agentKey === key); }
  function getById(id)          { return _read().find(e => e.id === id) || null; }
  function remove(id)           { _write(_read().filter(e => e.id !== id)); }
  function clear()              { _write([]); }
  function count()              { return _read().length; }

  window.AgentHistory = { save, getAll, getByAgent, getById, remove, clear, count, AGENT_META };
})();
