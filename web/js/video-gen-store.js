/**
 * VideoGenStore — local gallery of AI-generated videos for Reel (Video Studio)
 *
 * Same lightweight localStorage pattern as Mex's ProspectStore — a personal,
 * per-browser gallery of Seedance 2.0 generations (prompt, mode, params,
 * task id, live status, and the final video/thumbnail URL once ready).
 * Kept intentionally simple: no Supabase table, since these are transient
 * creative drafts a user downloads/publishes elsewhere rather than shared
 * team records like contacts or scheduled posts.
 */
window.VideoGenStore = (function () {
  'use strict';

  const KEY = 'reel_videos_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }

  function save(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
  }

  function genId() {
    return crypto.randomUUID ? crypto.randomUUID() : `vid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  /**
   * @param {Object} entry - {prompt, mode, imageUrl?, aspectRatio, duration, resolution, taskId}
   * @returns {Object} the created record, status='pending'
   */
  function create(entry) {
    const items = load();
    const record = {
      id: genId(),
      prompt: entry.prompt || '',
      mode: entry.mode || 'text-to-video',
      imageUrl: entry.imageUrl || null,
      aspectRatio: entry.aspectRatio || '16:9',
      duration: entry.duration || 5,
      resolution: entry.resolution || '1080p',
      taskId: entry.taskId || null,
      status: 'pending',
      videoUrl: null,
      thumbnailUrl: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    items.unshift(record);
    save(items);
    return record;
  }

  function update(id, patch) {
    const items = load();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    save(items);
    return items[idx];
  }

  function remove(id) {
    save(load().filter(i => i.id !== id));
  }

  function list() {
    return load();
  }

  function getById(id) {
    return load().find(i => i.id === id) || null;
  }

  return { create, update, remove, list, getById };
})();
