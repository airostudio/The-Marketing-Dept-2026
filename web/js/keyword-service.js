/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KEYWORD TRACKING & RESEARCH SERVICE
 * Production-ready keyword analysis, tracking, and research functionality
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        crawlDepth: 3,
        maxPages: 50,
        minKeywordLength: 2,
        maxKeywordLength: 60,
        stopWords: ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'i', 'my', 'me', 'he', 'she', 'his', 'her', 'not', 'no', 'yes', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'if', 'then', 'else', 'while', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'once'],
        corsProxies: [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ]
    };

    /**
     * Is this a real, reported search position?
     *
     * A tracked keyword carries position === null until a ranking provider
     * actually reports one. Comparing that null against a number silently
     * coerces it to 0, so `null <= 3` is true and an unranked keyword reads as
     * a number-one result. Every position comparison in this file and in the
     * pages that render it goes through here so the coercion cannot come back.
     */
    function isRanked(position) {
        return typeof position === 'number' && isFinite(position) && position > 0;
    }

    /**
     * The DataForSEO module that actually has ranking and metric methods.
     *
     * There are two DataForSEO objects on ApiConnector and they are not the
     * same shape. ApiConnector.SEOTools.dataforseo exposes only isAvailable,
     * getSerpResults and getKeywordData; getRankings and getKeywordMetrics
     * live on the top-level ApiConnector.DataForSEO. This file called them on
     * the SEOTools one, so with credentials configured it would have thrown
     * "getRankings is not a function" — and without them isAvailable() was
     * false, so it never got that far and the broken call was never reached.
     * One bug hid the other.
     *
     * Returns null when no module can do the job, so callers can say "no
     * provider" rather than crash.
     */
    function rankingProvider() {
        const conn = window.ApiConnector;
        if (!conn) return null;
        const candidates = [conn.DataForSEO, conn.SEOTools && conn.SEOTools.dataforseo];
        for (const m of candidates) {
            if (m && typeof m.isAvailable === 'function' && m.isAvailable()
                  && typeof m.getRankings === 'function') {
                return m;
            }
        }
        return null;
    }

    /**
     * First real number among the candidates, else null.
     *
     * Deliberately not `a || b || fallback`: DataForSEO legitimately returns 0
     * for a keyword with no measurable search volume, and `||` would discard
     * that real zero and fall through to the previous value — so a keyword
     * would keep showing a stale volume the provider had just contradicted.
     * A missing field is null; a measured 0 is 0.
     */
    function pickNumber(...candidates) {
        for (const c of candidates) {
            if (typeof c === 'number' && isFinite(c)) return c;
        }
        return null;
    }

    /** The module that can return search volume / difficulty, or null. */
    function metricsProvider() {
        const conn = window.ApiConnector;
        if (!conn) return null;
        const candidates = [conn.DataForSEO, conn.SEOTools && conn.SEOTools.dataforseo];
        for (const m of candidates) {
            if (m && typeof m.isAvailable === 'function' && m.isAvailable()
                  && typeof m.getKeywordMetrics === 'function') {
                return m;
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYWORD EXTRACTION & ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════

    const KeywordExtractor = {
        /**
         * Extract keywords from HTML content
         */
        extractFromHTML(html, url) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const extracted = {
                title: this.extractTitle(doc),
                metaDescription: this.extractMetaDescription(doc),
                metaKeywords: this.extractMetaKeywords(doc),
                headings: this.extractHeadings(doc),
                content: this.extractContent(doc),
                images: this.extractImageKeywords(doc),
                links: this.extractLinkText(doc),
                url: url
            };

            return this.analyzeExtracted(extracted);
        },

        extractTitle(doc) {
            const title = doc.querySelector('title');
            return title ? title.textContent.trim() : '';
        },

        extractMetaDescription(doc) {
            const meta = doc.querySelector('meta[name="description"]');
            return meta ? meta.getAttribute('content') || '' : '';
        },

        extractMetaKeywords(doc) {
            const meta = doc.querySelector('meta[name="keywords"]');
            if (!meta) return [];
            const content = meta.getAttribute('content') || '';
            return content.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
        },

        extractHeadings(doc) {
            const headings = { h1: [], h2: [], h3: [] };
            doc.querySelectorAll('h1').forEach(h => headings.h1.push(h.textContent.trim()));
            doc.querySelectorAll('h2').forEach(h => headings.h2.push(h.textContent.trim()));
            doc.querySelectorAll('h3').forEach(h => headings.h3.push(h.textContent.trim()));
            return headings;
        },

        extractContent(doc) {
            // Remove script, style, nav, footer, header elements
            const clone = doc.cloneNode(true);
            clone.querySelectorAll('script, style, nav, footer, header, aside, form, noscript').forEach(el => el.remove());

            const body = clone.querySelector('body');
            return body ? body.textContent.replace(/\s+/g, ' ').trim() : '';
        },

        extractImageKeywords(doc) {
            const keywords = [];
            doc.querySelectorAll('img[alt]').forEach(img => {
                const alt = img.getAttribute('alt');
                if (alt && alt.length > 2) keywords.push(alt.trim());
            });
            return keywords;
        },

        extractLinkText(doc) {
            const linkTexts = [];
            doc.querySelectorAll('a').forEach(a => {
                const text = a.textContent.trim();
                if (text && text.length > 2 && text.length < 100) {
                    linkTexts.push(text);
                }
            });
            return linkTexts;
        },

        analyzeExtracted(extracted) {
            const allText = [
                extracted.title,
                extracted.metaDescription,
                ...extracted.headings.h1,
                ...extracted.headings.h2,
                ...extracted.headings.h3,
                extracted.content,
                ...extracted.images,
                ...extracted.linkText || []
            ].join(' ');

            // Extract n-grams (1-4 words)
            const keywords = this.extractNGrams(allText);

            // Score keywords based on where they appear
            const scored = this.scoreKeywords(keywords, extracted);

            return {
                ...extracted,
                keywords: scored
            };
        },

        extractNGrams(text, maxN = 4) {
            const words = text.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= CONFIG.minKeywordLength && !CONFIG.stopWords.includes(w));

            const ngrams = {};

            for (let n = 1; n <= maxN; n++) {
                for (let i = 0; i <= words.length - n; i++) {
                    const gram = words.slice(i, i + n).join(' ');
                    if (gram.length <= CONFIG.maxKeywordLength) {
                        ngrams[gram] = (ngrams[gram] || 0) + 1;
                    }
                }
            }

            return ngrams;
        },

        scoreKeywords(ngrams, extracted) {
            const scored = [];

            for (const [keyword, count] of Object.entries(ngrams)) {
                let score = count;

                // Boost for appearance in title
                if (extracted.title.toLowerCase().includes(keyword)) score += 50;

                // Boost for appearance in meta description
                if (extracted.metaDescription.toLowerCase().includes(keyword)) score += 30;

                // Boost for appearance in H1
                if (extracted.headings.h1.some(h => h.toLowerCase().includes(keyword))) score += 40;

                // Boost for appearance in H2
                if (extracted.headings.h2.some(h => h.toLowerCase().includes(keyword))) score += 20;

                // Boost for appearance in meta keywords
                if (extracted.metaKeywords.includes(keyword)) score += 25;

                // Boost for multi-word keywords (more specific)
                const wordCount = keyword.split(' ').length;
                if (wordCount >= 2 && wordCount <= 4) score += wordCount * 5;

                scored.push({
                    keyword,
                    count,
                    score,
                    wordCount
                });
            }

            return scored.sort((a, b) => b.score - a.score);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SITE CRAWLER
    // ═══════════════════════════════════════════════════════════════════════════

    const SiteCrawler = {
        visited: new Set(),
        results: [],
        baseUrl: null,
        callbacks: null,

        async crawl(url, callbacks = {}) {
            this.visited = new Set();
            this.results = [];
            this.callbacks = callbacks;

            try {
                this.baseUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
            } catch (e) {
                console.error('Invalid URL:', url);
                return { success: false, error: 'Invalid URL', keywords: [] };
            }

            if (callbacks.onStart) callbacks.onStart();

            await this.crawlPage(this.baseUrl.href, 0);

            const aggregated = this.aggregateKeywords();

            if (callbacks.onComplete) callbacks.onComplete(aggregated);

            return {
                success: true,
                pagesAnalyzed: this.results.length,
                keywords: aggregated
            };
        },

        async crawlPage(url, depth) {
            if (depth > CONFIG.crawlDepth || this.visited.size >= CONFIG.maxPages) return;
            if (this.visited.has(url)) return;

            this.visited.add(url);

            try {
                const html = await this.fetchPage(url);
                if (!html) return;

                if (this.callbacks?.onPageCrawled) {
                    this.callbacks.onPageCrawled(url, this.visited.size);
                }

                const extracted = KeywordExtractor.extractFromHTML(html, url);
                this.results.push(extracted);

                // Extract internal links and continue crawling
                const links = this.extractInternalLinks(html, url);

                for (const link of links.slice(0, 10)) {
                    await this.crawlPage(link, depth + 1);
                    await this.delay(100); // Rate limiting
                }
            } catch (error) {
                console.warn(`Failed to crawl ${url}:`, error.message);
            }
        },

        async fetchPage(url) {
            for (const proxy of CONFIG.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(url), {
                        headers: { 'Accept': 'text/html' }
                    });
                    if (response.ok) {
                        return await response.text();
                    }
                } catch (e) {
                    continue;
                }
            }

            // Try direct fetch (works for same-origin or CORS-enabled sites)
            try {
                const response = await fetch(url, { mode: 'cors' });
                if (response.ok) return await response.text();
            } catch (e) {
                // Ignore
            }

            return null;
        },

        extractInternalLinks(html, baseUrl) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const links = [];
            const base = new URL(baseUrl);

            doc.querySelectorAll('a[href]').forEach(a => {
                try {
                    const href = a.getAttribute('href');
                    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

                    const url = new URL(href, baseUrl);

                    // Only internal links
                    if (url.hostname === base.hostname && !this.visited.has(url.href)) {
                        // Skip common non-content pages
                        if (!url.pathname.match(/\.(pdf|jpg|png|gif|css|js|xml|json)$/i)) {
                            links.push(url.href);
                        }
                    }
                } catch (e) {
                    // Invalid URL, skip
                }
            });

            return [...new Set(links)];
        },

        aggregateKeywords() {
            const aggregate = {};

            for (const page of this.results) {
                for (const kw of page.keywords) {
                    if (!aggregate[kw.keyword]) {
                        aggregate[kw.keyword] = {
                            keyword: kw.keyword,
                            totalScore: 0,
                            totalCount: 0,
                            pages: [],
                            wordCount: kw.wordCount
                        };
                    }
                    aggregate[kw.keyword].totalScore += kw.score;
                    aggregate[kw.keyword].totalCount += kw.count;
                    aggregate[kw.keyword].pages.push(page.url);
                }
            }

            return Object.values(aggregate)
                .sort((a, b) => b.totalScore - a.totalScore)
                .slice(0, 500);
        },

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYWORD TRACKING SERVICE
    // ═══════════════════════════════════════════════════════════════════════════

    const KeywordTracker = {
        /**
         * Get tracked keywords for the current project
         */
        getTrackedKeywords() {
            try {
                const stored = localStorage.getItem('seo-tracked-keywords');
                return stored ? JSON.parse(stored) : [];
            } catch (e) {
                return [];
            }
        },

        /**
         * Save tracked keywords
         */
        saveTrackedKeywords(keywords) {
            const value = JSON.stringify(keywords);
            localStorage.setItem('seo-tracked-keywords', value);
            if (window.MarketingStore) { window.MarketingStore.set('keywords', 'seo-tracked-keywords', value).catch(function(){}); }
            this.dispatchUpdate();
        },

        /**
         * Add keywords to track
         */
        addKeywords(keywords) {
            const current = this.getTrackedKeywords();
            const self = this;
            const newKeywords = keywords.map(kw => ({
                id: this.generateId(),
                keyword: typeof kw === 'string' ? kw : kw.keyword,
                position: kw.position || null,
                previousPosition: kw.previousPosition || null,
                searchVolume: kw.searchVolume || 0,
                difficulty: kw.difficulty || this.estimateDifficulty(kw.keyword || kw),
                cpc: kw.cpc || '0.00',
                intent: kw.intent || this.determineIntent(kw.keyword || kw),
                url: kw.url || null,
                trend: kw.trend || 'stable',
                addedAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            }));

            // Avoid duplicates
            const existingKeywords = new Set(current.map(k => k.keyword.toLowerCase()));
            const uniqueNew = newKeywords.filter(k => !existingKeywords.has(k.keyword.toLowerCase()));

            this.saveTrackedKeywords([...current, ...uniqueNew]);

            // Asynchronously fetch real metrics from whichever module can
            // actually supply them (see rankingProvider/metricsProvider — the
            // two DataForSEO objects on ApiConnector expose different methods).
            const metricsApi = metricsProvider();
            const rankingApi = rankingProvider();
            if ((metricsApi || rankingApi) && uniqueNew.length > 0) {
                const kwStrings = uniqueNew.map(function(k) { return k.keyword; });
                Promise.all([
                    metricsApi ? metricsApi.getKeywordMetrics(kwStrings).catch(function() { return null; })
                               : Promise.resolve(null),
                    rankingApi ? rankingApi.getRankings(kwStrings).catch(function() { return null; })
                               : Promise.resolve(null)
                ]).then(function(apiResults) {
                    const metrics = apiResults[0];
                    const rankings = apiResults[1];
                    if (metrics || rankings) {
                        const all = self.getTrackedKeywords();
                        const updated = all.map(function(k) {
                            const metric = metrics && metrics.find(function(m) { return m.keyword === k.keyword; });
                            const ranking = rankings && rankings.find(function(r) { return r.keyword === k.keyword; });
                            if (metric || ranking) {
                                return Object.assign({}, k, {
                                    // pickNumber, not ||: a provider-reported
                                    // volume of 0 is a real answer and must not
                                    // fall through to the previous value.
                                    searchVolume: metric
                                        ? pickNumber(metric.searchVolume, metric.search_volume, k.searchVolume)
                                        : k.searchVolume,
                                    difficulty: metric
                                        ? pickNumber(metric.difficulty, metric.keyword_difficulty, k.difficulty)
                                        : k.difficulty,
                                    cpc: (metric && metric.cpc) || k.cpc,
                                    position: (ranking && ranking.position) || k.position,
                                    lastUpdated: new Date().toISOString()
                                });
                            }
                            return k;
                        });
                        self.saveTrackedKeywords(updated);
                    }
                }).catch(function(e) {
                    console.warn('Failed to fetch keyword metrics from API:', e);
                });
            }

            return uniqueNew;
        },

        /**
         * Remove a keyword from tracking
         */
        removeKeyword(keywordId) {
            const keywords = this.getTrackedKeywords().filter(k => k.id !== keywordId);
            this.saveTrackedKeywords(keywords);
        },

        /**
         * Update keyword data
         */
        updateKeyword(keywordId, updates) {
            const keywords = this.getTrackedKeywords().map(k => {
                if (k.id === keywordId) {
                    return {
                        ...k,
                        ...updates,
                        previousPosition: k.position,
                        lastUpdated: new Date().toISOString()
                    };
                }
                return k;
            });
            this.saveTrackedKeywords(keywords);
        },

        /**
         * Refresh tracked positions from the ranking provider.
         *
         * This was `simulateRankingUpdate()`, and it was two dead ends in one.
         * It was synchronous, so the caller repainted the table and reported
         * success before the provider had answered — a real update never showed
         * on the click that asked for it. And when no provider was configured it
         * did nothing at all and returned the keywords unchanged, so the button
         * was indistinguishable from a button that was not wired up.
         *
         * Now async, and it always resolves to a description of what happened:
         *   { ok, updated, checked, reason }
         * so the page can say "12 positions updated", "no ranking provider is
         * connected", or the provider's own error, rather than nothing.
         */
        async refreshRankings() {
            const keywords = this.getTrackedKeywords();
            if (!keywords.length) {
                return { ok: false, updated: 0, checked: 0, reason: 'no_keywords' };
            }

            const provider = rankingProvider();
            if (!provider) {
                return { ok: false, updated: 0, checked: keywords.length, reason: 'no_provider' };
            }

            const names = keywords.map(k => k.keyword);
            let rankings, metrics = null;
            try {
                // Volume and difficulty are fetched alongside the positions, so
                // one refresh fills every column the table shows rather than
                // leaving two of them permanently blank.
                const metricsApi = metricsProvider();
                const [r, m] = await Promise.all([
                    provider.getRankings(names),
                    metricsApi ? metricsApi.getKeywordMetrics(names).catch(() => null) : Promise.resolve(null),
                ]);
                rankings = r;
                metrics = m;
            } catch (e) {
                return {
                    ok: false, updated: 0, checked: keywords.length,
                    reason: 'provider_error', detail: e.message,
                };
            }

            if (!Array.isArray(rankings) || rankings.length === 0) {
                return { ok: true, updated: 0, checked: keywords.length, reason: 'no_results' };
            }

            let updatedCount = 0;
            const current = this.getTrackedKeywords();
            const next = current.map(k => {
                const ranking = rankings.find(r => r.keyword === k.keyword);
                const metric = Array.isArray(metrics)
                    ? metrics.find(m => m.keyword === k.keyword) : null;
                if (!ranking || !ranking.position) {
                    const patch = {};

                    // "We searched and your site was not in the results" is a
                    // real finding — the keyword has dropped out, or never
                    // ranked. Recording it as unranked is the truth; leaving a
                    // stale position would keep showing a ranking the provider
                    // has just told us is gone. `checked` separates that from
                    // "this keyword was not in the response at all".
                    if (ranking && ranking.checked && isRanked(k.position)) {
                        patch.previousPosition = k.position;
                        patch.position = null;
                        patch.trend = 'lost';
                        updatedCount++;
                    }

                    // Metrics can arrive for a keyword that has no position yet.
                    if (metric) {
                        patch.searchVolume = pickNumber(metric.searchVolume, metric.search_volume, k.searchVolume);
                        patch.difficulty = pickNumber(metric.difficulty, metric.keyword_difficulty, k.difficulty);
                    }

                    if (!Object.keys(patch).length) return k;
                    patch.lastUpdated = new Date().toISOString();
                    return Object.assign({}, k, patch);
                }
                updatedCount++;
                return Object.assign({}, k, {
                    previousPosition: k.position,
                    position: ranking.position,
                    searchVolume: metric
                        ? pickNumber(metric.searchVolume, metric.search_volume, k.searchVolume)
                        : k.searchVolume,
                    difficulty: metric
                        ? pickNumber(metric.difficulty, metric.keyword_difficulty, k.difficulty)
                        : k.difficulty,
                    // The first real ranking for a keyword has nothing to
                    // compare against. Comparing to a null previous position
                    // made `5 > null` true, so every keyword's first ever
                    // result was reported as a decline.
                    trend: !isRanked(k.position) ? 'new'
                        : ranking.position < k.position ? 'up'
                        : ranking.position > k.position ? 'down' : 'stable',
                    lastUpdated: new Date().toISOString(),
                });
            });

            this.saveTrackedKeywords(next);

            // The market travels with the result. A position measured in the
            // United States is not a fact about an Australian business, and
            // the page needs to be able to say which country it describes.
            const sample = rankings.find(r => r && r.market) || {};
            return {
                ok: true, updated: updatedCount, checked: current.length, reason: null,
                market: sample.market || null,
                marketSource: sample.marketSource || null,
            };
        },

        /**
         * Get keyword statistics
         */
        getStats() {
            const keywords = this.getTrackedKeywords();
            const total = keywords.length;

            // A tracked keyword has position === null until a ranking provider
            // actually reports where it sits. Every count below used to be
            // written as `k.position <= 3`, and in JavaScript `null <= 3` is
            // true — so a keyword nobody had ever looked up was counted as
            // ranking in the top 3, the top 10 AND the top 20 at once. Adding
            // twenty untracked keywords reported "20 in the top 3".
            //
            // Ranked keywords are counted here; unranked ones are reported
            // separately as `unranked` so the page can say how much of the list
            // has no data behind it rather than quietly folding it into a win.
            const ranked = keywords.filter(k => isRanked(k.position));
            const unranked = total - ranked.length;

            const top3  = ranked.filter(k => k.position <= 3).length;
            const top10 = ranked.filter(k => k.position <= 10).length;
            const top20 = ranked.filter(k => k.position <= 20).length;

            // A move is only a move between two known positions.
            const improved = keywords.filter(k =>
                isRanked(k.position) && isRanked(k.previousPosition) && k.position < k.previousPosition).length;
            const declined = keywords.filter(k =>
                isRanked(k.position) && isRanked(k.previousPosition) && k.position > k.previousPosition).length;

            // Averaging over every tracked keyword used to add null as 0, which
            // pulled the average toward "position 0" — i.e. an unranked keyword
            // made the average look BETTER than it was. Averaged over the ranked
            // ones only, and null when none of them are ranked, because there is
            // no average position of nothing.
            const avgPosition = ranked.length
                ? (ranked.reduce((sum, k) => sum + k.position, 0) / ranked.length).toFixed(1)
                : null;

            const estTraffic = ranked.reduce((sum, k) => {
                return sum + this.estimateTrafficFromPosition(k.position, k.searchVolume);
            }, 0);

            return {
                total,
                ranked: ranked.length,
                unranked,
                top3,
                top10,
                top20,
                improved,
                declined,
                avgPosition,
                estTraffic: Math.round(estTraffic),
                distribution: {
                    '1-3': top3,
                    '4-10': top10 - top3,
                    '11-20': top20 - top10,
                    '21-50': ranked.filter(k => k.position > 20 && k.position <= 50).length,
                    '50+': ranked.filter(k => k.position > 50).length,
                    'Not ranked': unranked
                }
            };
        },

        /**
         * Get biggest gainers and decliners
         */
        getMovers() {
            // Both ends of the move have to be real positions. `!== null` let
            // undefined through, and `undefined - 5` is NaN — which sorts
            // unpredictably and shows as a blank change in the table.
            const keywords = this.getTrackedKeywords()
                .filter(k => isRanked(k.position) && isRanked(k.previousPosition));

            const withChange = keywords.map(k => ({
                ...k,
                change: k.previousPosition - k.position
            }));

            return {
                gainers: withChange
                    .filter(k => k.change > 0)
                    .sort((a, b) => b.change - a.change)
                    .slice(0, 10),
                decliners: withChange
                    .filter(k => k.change < 0)
                    .sort((a, b) => a.change - b.change)
                    .slice(0, 10)
            };
        },

        // Utility methods
        generateId() {
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                const arr = new Uint8Array(7);
                crypto.getRandomValues(arr);
                return 'kw_' + Date.now().toString(36) + Array.from(arr, function(b) { return b.toString(36); }).join('').substr(0, 9);
            }
            return 'kw_' + Date.now().toString(36) + '_' + (Date.now() % 1000000).toString(36);
        },

        simulatePosition() {
            // No simulated positions - return null when no real data is available
            return null;
        },

        estimateSearchVolume(keyword) {
            // Return 0 when no real API data is available
            return 0;
        },

        /**
         * Keyword difficulty, or null when nobody has measured it.
         *
         * This used to return `90 - (words * 15)` — a word count, rescaled.
         * It never looked at a search result, a competing page, or a domain;
         * a three-word phrase scored 45 whether it was "buy cheap insurance"
         * or "purple weasel taxidermy". That number was then rendered in the
         * keyword table beside a coloured difficulty bar, and written into
         * Quick Wins as the sentence "Low difficulty (30)", which asserts a
         * competitive analysis that had not happened.
         *
         * Real difficulty comes from a ranking provider (DataForSEO supplies
         * it as keyword_difficulty and it is stored on the keyword when a
         * refresh runs). Without one there is no honest number, so the callers
         * get null and render it as "not measured".
         */
        estimateDifficulty(keyword) {
            return null;
        },

        estimateCPC(keyword) {
            // Return 0 when no real API data is available
            return '0.00';
        },

        determineIntent(keyword) {
            const kw = keyword.toLowerCase();
            if (kw.includes('buy') || kw.includes('price') || kw.includes('cheap') || kw.includes('deal') || kw.includes('discount') || kw.includes('order')) {
                return 'transactional';
            }
            if (kw.includes('best') || kw.includes('top') || kw.includes('review') || kw.includes('vs') || kw.includes('compare')) {
                return 'commercial';
            }
            if (kw.includes('how') || kw.includes('what') || kw.includes('why') || kw.includes('guide') || kw.includes('tutorial')) {
                return 'informational';
            }
            if (kw.includes('login') || kw.includes('sign in') || kw.includes('official')) {
                return 'navigational';
            }
            return 'informational';
        },

        estimateTrafficFromPosition(position, searchVolume) {
            // CTR estimates based on position
            const ctrByPosition = {
                1: 0.316, 2: 0.158, 3: 0.109, 4: 0.078, 5: 0.059,
                6: 0.046, 7: 0.037, 8: 0.030, 9: 0.025, 10: 0.021
            };

            // Without a position there is no CTR to apply. This used to fall
            // through `null <= 10` into `ctrByPosition[null] || 0.021`, crediting
            // an unranked keyword with the click-through rate of a tenth-place
            // result — traffic invented for a page that may not rank at all.
            if (!isRanked(position) || !isFinite(searchVolume) || searchVolume <= 0) return 0;

            if (position <= 10) {
                return searchVolume * (ctrByPosition[position] || 0.021);
            }
            if (position <= 20) {
                return searchVolume * 0.01;
            }
            if (position <= 50) {
                return searchVolume * 0.002;
            }
            return 0;
        },

        dispatchUpdate() {
            window.dispatchEvent(new CustomEvent('keywordsUpdated', {
                detail: { keywords: this.getTrackedKeywords() }
            }));
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYWORD RESEARCH SERVICE
    // ═══════════════════════════════════════════════════════════════════════════

    const KeywordResearch = {
        /**
         * Research keywords based on seed keywords
         */
        async research(seedKeywords, options = {}) {
            const seeds = Array.isArray(seedKeywords)
                ? seedKeywords
                : seedKeywords.split(',').map(k => k.trim()).filter(k => k);

            // Try real API data from whichever module actually exposes
            // getKeywordMetrics — SEOTools.dataforseo does not have it, so this
            // call named a function that was never there.
            const metricsApi = metricsProvider();
            if (metricsApi) {
                try {
                    const apiResults = await metricsApi.getKeywordMetrics(seeds);
                    if (apiResults && apiResults.length > 0) {
                        const mapped = apiResults.map(r => ({
                            keyword: r.keyword,
                            type: r.type || 'api',
                            // pickNumber: a provider-reported 0 is a measurement,
                            // and `|| 0` would coerce a missing field to the same
                            // thing, making "no data" indistinguishable from
                            // "measured as zero".
                            searchVolume: pickNumber(r.searchVolume, r.search_volume),
                            difficulty: pickNumber(r.difficulty, r.keyword_difficulty),
                            cpc: r.cpc || '0.00',
                            intent: r.intent || this.determineSearchIntent(r.keyword, r.type || 'api'),
                            trend: r.trend || 'stable',
                            competition: r.competition || 'medium',
                            opportunity: this.calculateOpportunity(r.searchVolume || r.search_volume || 0, r.difficulty || r.keyword_difficulty || 0)
                        }));
                        this.saveResearchResults(mapped);
                        return mapped;
                    }
                } catch (e) {
                    console.warn('DataForSEO keyword research failed, falling back:', e);
                }
            }

            // Try SEMrush for keyword discovery
            if (window.ApiConnector?.SEOTools?.semrush?.getOrganicKeywords) {
                try {
                    const semrushResults = await window.ApiConnector.SEOTools.semrush.getOrganicKeywords(seeds);
                    if (semrushResults && semrushResults.length > 0) {
                        const mapped = semrushResults.map(r => ({
                            keyword: r.keyword,
                            type: r.type || 'api',
                            searchVolume: r.searchVolume || r.search_volume || 0,
                            difficulty: r.difficulty || 0,
                            cpc: r.cpc || '0.00',
                            intent: r.intent || this.determineSearchIntent(r.keyword, r.type || 'api'),
                            trend: r.trend || 'stable',
                            competition: r.competition || 'medium',
                            opportunity: this.calculateOpportunity(r.searchVolume || r.search_volume || 0, r.difficulty || 0)
                        }));
                        this.saveResearchResults(mapped);
                        return mapped;
                    }
                } catch (e) {
                    console.warn('SEMrush keyword discovery failed, falling back:', e);
                }
            }

            // Fall back to local keyword generation (with zeros for unknown metrics)
            const results = [];

            for (const seed of seeds) {
                // Generate related keywords
                const related = this.generateRelatedKeywords(seed);
                results.push(...related);
            }

            // Score and deduplicate
            const unique = this.deduplicateAndScore(results);

            // Save research results
            this.saveResearchResults(unique);

            return unique;
        },

        generateRelatedKeywords(seed) {
            const modifiers = {
                prefixes: ['best', 'top', 'cheap', 'free', 'professional', 'online', 'local', 'fast', 'easy', 'how to', 'what is', 'guide to'],
                suffixes: ['services', 'tools', 'software', 'tips', 'guide', 'tutorial', 'examples', 'ideas', 'strategies', 'solutions', 'templates', 'pricing', 'reviews', 'alternatives', 'for beginners', 'for small business'],
                questions: ['how to', 'what is', 'why is', 'when to', 'where to', 'which', 'can you'],
                commercial: ['buy', 'price', 'cost', 'compare', 'vs', 'review', 'best', 'top rated'],
                longtail: ['for beginners', 'step by step', 'complete guide', 'in 2026', 'examples', 'checklist']
            };

            const results = [];
            const seedLower = seed.toLowerCase();

            // Original seed
            results.push(this.createKeywordResult(seed, 'seed'));

            // Add prefix variations
            for (const prefix of modifiers.prefixes) {
                results.push(this.createKeywordResult(`${prefix} ${seedLower}`, 'prefix'));
            }

            // Add suffix variations
            for (const suffix of modifiers.suffixes) {
                results.push(this.createKeywordResult(`${seedLower} ${suffix}`, 'suffix'));
            }

            // Add question variations
            for (const question of modifiers.questions) {
                results.push(this.createKeywordResult(`${question} ${seedLower}`, 'question'));
            }

            // Add commercial variations
            for (const commercial of modifiers.commercial.slice(0, 5)) {
                results.push(this.createKeywordResult(`${commercial} ${seedLower}`, 'commercial'));
            }

            // Add long-tail variations
            for (const longtail of modifiers.longtail) {
                results.push(this.createKeywordResult(`${seedLower} ${longtail}`, 'longtail'));
            }

            return results;
        },

        createKeywordResult(keyword, type) {
            const difficulty = this.calculateDifficulty(keyword, type);

            return {
                keyword: keyword,
                type: type,
                searchVolume: 0,
                difficulty: difficulty,
                cpc: '0.00',
                intent: this.determineSearchIntent(keyword, type),
                trend: 'stable',
                competition: 'medium',
                opportunity: this.calculateOpportunity(0, difficulty)
            };
        },

        calculateDifficulty(keyword, type) {
            const wordCount = keyword.split(' ').length;
            let baseDifficulty = 50;

            // Longer keywords are usually easier
            baseDifficulty -= wordCount * 8;

            // Question keywords are often easier
            if (type === 'question') baseDifficulty -= 10;

            // Long-tail keywords are easier
            if (type === 'longtail') baseDifficulty -= 15;

            // Commercial keywords are harder
            if (type === 'commercial') baseDifficulty += 10;

            // No random variance - deterministic calculation
            return Math.max(5, Math.min(95, baseDifficulty));
        },

        determineSearchIntent(keyword, type) {
            if (type === 'question') return 'informational';
            if (type === 'commercial') return 'commercial';
            if (keyword.match(/buy|price|cost|order|shop/i)) return 'transactional';
            if (keyword.match(/best|top|review|vs|compare/i)) return 'commercial';
            if (keyword.match(/how|what|why|guide|tutorial/i)) return 'informational';
            return 'informational';
        },

        determineTrend() {
            // Return stable when no real trend data is available
            return 'stable';
        },

        determineCompetition() {
            // Return medium when no real competition data is available
            return 'medium';
        },

        calculateOpportunity(volume, difficulty) {
            // Higher volume + lower difficulty = better opportunity
            const score = (volume / 1000) * (100 - difficulty);
            if (score > 100) return 'excellent';
            if (score > 50) return 'good';
            if (score > 20) return 'moderate';
            return 'low';
        },

        deduplicateAndScore(results) {
            const unique = {};
            for (const result of results) {
                const key = result.keyword.toLowerCase();
                if (!unique[key] || result.searchVolume > unique[key].searchVolume) {
                    unique[key] = result;
                }
            }
            return Object.values(unique).sort((a, b) => b.searchVolume - a.searchVolume);
        },

        saveResearchResults(results) {
            const value = JSON.stringify({
                results,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem('seo-keyword-research', value);
            if (window.MarketingStore) { window.MarketingStore.set('keywords', 'seo-keyword-research', value).catch(function(){}); }
        },

        getResearchResults() {
            try {
                const stored = localStorage.getItem('seo-keyword-research');
                return stored ? JSON.parse(stored) : { results: [], timestamp: null };
            } catch (e) {
                return { results: [], timestamp: null };
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYWORD OPPORTUNITIES
    // ═══════════════════════════════════════════════════════════════════════════

    const KeywordOpportunities = {
        /**
         * Get quick win opportunities
         */
        getQuickWins() {
            const tracked = KeywordTracker.getTrackedKeywords();

            // Quick wins: Low difficulty, high volume, not in top 10.
            // All three inputs must be real. `k.difficulty < 40` was true for
            // null, and `k.position > 10` false for null, so the filter's
            // behaviour depended on JavaScript's coercion rules rather than on
            // whether anything had been measured.
            return tracked
                .filter(k => typeof k.difficulty === 'number' && k.difficulty < 40
                          && typeof k.searchVolume === 'number' && k.searchVolume > 500
                          && isRanked(k.position) && k.position > 10)
                .sort((a, b) => {
                    const scoreA = (b.searchVolume / 1000) * (100 - a.difficulty);
                    const scoreB = (a.searchVolume / 1000) * (100 - b.difficulty);
                    return scoreB - scoreA;
                })
                .slice(0, 20)
                .map(k => ({
                    ...k,
                    opportunityType: 'quick_win',
                    reason: `Low difficulty (${k.difficulty}) with ${k.searchVolume.toLocaleString()} monthly searches`
                }));
        },

        /**
         * Get striking distance keywords (positions 11-20)
         */
        getStrikingDistance() {
            const tracked = KeywordTracker.getTrackedKeywords();

            return tracked
                .filter(k => isRanked(k.position) && k.position >= 11 && k.position <= 20)
                .sort((a, b) => a.position - b.position)
                .map(k => ({
                    ...k,
                    opportunityType: 'striking_distance',
                    reason: `Position ${k.position} - just outside top 10`,
                    potentialTraffic: Math.round(k.searchVolume * 0.05)
                }));
        },

        /**
         * Get content gap opportunities
         */
        getContentGaps() {
            const research = KeywordResearch.getResearchResults();
            const tracked = KeywordTracker.getTrackedKeywords();
            const trackedKeywords = new Set(tracked.map(k => k.keyword.toLowerCase()));

            return research.results
                .filter(k => !trackedKeywords.has(k.keyword.toLowerCase()))
                .filter(k => k.searchVolume > 200 && k.difficulty < 50)
                .slice(0, 50)
                .map(k => ({
                    ...k,
                    opportunityType: 'content_gap',
                    reason: `Not targeting this keyword yet - ${k.searchVolume.toLocaleString()} monthly searches`
                }));
        },

        /**
         * Get high-potential keywords (high volume, manageable difficulty)
         */
        getHighPotential() {
            const tracked = KeywordTracker.getTrackedKeywords();

            return tracked
                .filter(k => k.searchVolume > 1000 && k.difficulty < 60)
                .sort((a, b) => b.searchVolume - a.searchVolume)
                .slice(0, 20)
                .map(k => ({
                    ...k,
                    opportunityType: 'high_potential',
                    reason: `High volume (${k.searchVolume.toLocaleString()}) with moderate difficulty (${k.difficulty})`
                }));
        },

        /**
         * Get all opportunities summary
         */
        getAllOpportunities() {
            return {
                quickWins: this.getQuickWins(),
                strikingDistance: this.getStrikingDistance(),
                contentGaps: this.getContentGaps(),
                highPotential: this.getHighPotential(),
                stats: {
                    totalQuickWins: this.getQuickWins().length,
                    totalStrikingDistance: this.getStrikingDistance().length,
                    totalContentGaps: this.getContentGaps().length,
                    totalHighPotential: this.getHighPotential().length
                }
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYWORD SUGGESTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const KeywordSuggestions = {
        /**
         * Generate suggestions based on crawled site content
         */
        generateFromCrawl(crawlResults) {
            if (!crawlResults || !crawlResults.keywords) return [];

            const tracked = KeywordTracker.getTrackedKeywords();
            const trackedSet = new Set(tracked.map(k => k.keyword.toLowerCase()));

            // Filter out already tracked keywords
            const suggestions = crawlResults.keywords
                .filter(k => !trackedSet.has(k.keyword.toLowerCase()))
                .filter(k => k.wordCount >= 2 && k.wordCount <= 4) // Focus on meaningful phrases
                .slice(0, 100);

            return suggestions.map(k => ({
                keyword: k.keyword,
                relevanceScore: k.totalScore,
                frequency: k.totalCount,
                pagesFound: k.pages.length,
                estimatedVolume: KeywordTracker.estimateSearchVolume(k.keyword),
                estimatedDifficulty: KeywordTracker.estimateDifficulty(k.keyword),
                intent: KeywordTracker.determineIntent(k.keyword),
                source: 'site_crawl'
            }));
        },

        /**
         * Get suggestions based on current content
         */
        async getSuggestionsForUrl(url) {
            const crawlResult = await SiteCrawler.crawl(url);
            if (crawlResult.success) {
                return this.generateFromCrawl(crawlResult);
            }
            return [];
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    window.KeywordService = {
        // Extraction & Crawling
        KeywordExtractor,
        SiteCrawler,

        // Tracking
        KeywordTracker,

        // Research
        KeywordResearch,

        // Opportunities
        KeywordOpportunities,

        // Suggestions
        KeywordSuggestions,

        // Convenience methods
        async crawlSite(url, callbacks) {
            return SiteCrawler.crawl(url, callbacks);
        },

        getTrackedKeywords() {
            return KeywordTracker.getTrackedKeywords();
        },

        addKeywords(keywords) {
            return KeywordTracker.addKeywords(keywords);
        },

        getKeywordStats() {
            return KeywordTracker.getStats();
        },

        async researchKeywords(seeds) {
            return KeywordResearch.research(seeds);
        },

        getOpportunities() {
            return KeywordOpportunities.getAllOpportunities();
        },

        async generateSuggestions(url) {
            return KeywordSuggestions.getSuggestionsForUrl(url);
        }
    };

    console.log('KeywordService initialized');

})();
