/**
 * api-connector.js
 * Production API connector for external marketing platform integrations.
 * Reads configuration from window.APP_CONFIG (see config.js).
 * Uses window.isApiEnabled(path) to verify API availability.
 *
 * Exposes: window.ApiConnector
 * ES5-compatible. No external dependencies beyond fetch().
 */
(function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  var DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  var MAX_RETRIES = 3;
  var BACKOFF_BASE = 1000; // 1 second

  function getConfig(path) {
    var parts = path.split('.');
    var obj = window.APP_CONFIG;
    if (!obj) return undefined;
    for (var i = 0; i < parts.length; i++) {
      if (obj === undefined || obj === null) return undefined;
      obj = obj[parts[i]];
    }
    return obj;
  }

  function apiEnabled(path) {
    if (typeof window.isApiEnabled === 'function') {
      return window.isApiEnabled(path);
    }
    return !!getConfig(path);
  }

  // Read an integration credential off the active SEO project. The wizard
  // saves integrations as { ahrefs: { 'API Key': '...' } } keyed by the form
  // label, so we look up whichever shape is present. Returns '' if no
  // project, no integration, or no value.
  function getProjectIntegrationValue(provider, fieldNames) {
    try {
      var project = (window.ProjectService && typeof window.ProjectService.getCurrentProjectSync === 'function')
        ? window.ProjectService.getCurrentProjectSync()
        : null;
      if (!project) {
        var raw = localStorage.getItem('seo-current-project-data');
        if (raw) project = JSON.parse(raw);
      }
      if (!project || !project.integrations) return '';
      var creds = project.integrations[provider];
      if (!creds || typeof creds !== 'object') return '';
      for (var i = 0; i < fieldNames.length; i++) {
        var v = creds[fieldNames[i]];
        if (v && String(v).trim()) return String(v).trim();
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // ---- Cache helpers using localStorage ----

  function cacheKey(namespace, key) {
    return 'api_conn_' + namespace + '_' + key;
  }

  function cacheGet(namespace, key) {
    try {
      var raw = localStorage.getItem(cacheKey(namespace, key));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (Date.now() > entry.expires) {
        localStorage.removeItem(cacheKey(namespace, key));
        return null;
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(namespace, key, data, ttl) {
    try {
      var entry = {
        data: data,
        expires: Date.now() + (ttl || DEFAULT_CACHE_TTL)
      };
      localStorage.setItem(cacheKey(namespace, key), JSON.stringify(entry));
    } catch (e) {
      // Storage full or unavailable — silently ignore
    }
  }

  // ---- Fetch with retry + exponential backoff ----

  function wait(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function fetchWithRetry(url, options, attempt) {
    attempt = attempt || 1;
    return fetch(url, options).then(function(response) {
      if (response.ok) return response.json();
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        var delay = BACKOFF_BASE * Math.pow(2, attempt - 1);
        return wait(delay).then(function() {
          return fetchWithRetry(url, options, attempt + 1);
        });
      }
      return response.text().then(function(body) {
        var err = new Error('HTTP ' + response.status + ': ' + body);
        err.status = response.status;
        throw err;
      });
    }).catch(function(err) {
      if (attempt < MAX_RETRIES && !err.status) {
        var delay = BACKOFF_BASE * Math.pow(2, attempt - 1);
        return wait(delay).then(function() {
          return fetchWithRetry(url, options, attempt + 1);
        });
      }
      throw err;
    });
  }

  function safeCall(label, fn) {
    try {
      return fn().catch(function(err) {
        console.error('[ApiConnector.' + label + ']', err);
        return null;
      });
    } catch (e) {
      console.error('[ApiConnector.' + label + ']', e);
      return Promise.resolve(null);
    }
  }

  function buildQueryString(params) {
    var parts = [];
    for (var key in params) {
      if (params.hasOwnProperty(key) && params[key] !== undefined) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
      }
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  function formatDate(d) {
    var date = d instanceof Date ? d : new Date(d);
    var y = date.getFullYear();
    var m = ('0' + (date.getMonth() + 1)).slice(-2);
    var day = ('0' + date.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  // ---------------------------------------------------------------------------
  // 1. Google Analytics — GA4 Data API
  // ---------------------------------------------------------------------------

  var GoogleAnalytics = (function() {
    var NS = 'ga4';

    function getPropertyId() {
      return getConfig('google.analytics.propertyId') || getConfig('ga4.propertyId');
    }

    function getAccessToken() {
      return getConfig('google.analytics.accessToken') || getConfig('ga4.accessToken');
    }

    function baseUrl() {
      var propId = getPropertyId();
      return 'https://analyticsdata.googleapis.com/v1beta/properties/' + propId;
    }

    function authHeaders() {
      return {
        'Authorization': 'Bearer ' + getAccessToken(),
        'Content-Type': 'application/json'
      };
    }

    function isAvailable() {
      return apiEnabled('google.analytics') && !!getPropertyId() && !!getAccessToken();
    }

    function getReport(options) {
      return safeCall('GoogleAnalytics.getReport', function() {
        var key = JSON.stringify(options || {});
        var cached = cacheGet(NS, 'report_' + key);
        if (cached) return Promise.resolve(cached);

        var body = {};
        if (options.dateRange) {
          body.dateRanges = [{
            startDate: options.dateRange.startDate || options.dateRange.start,
            endDate: options.dateRange.endDate || options.dateRange.end
          }];
        }
        if (options.metrics) {
          body.metrics = options.metrics.map(function(m) {
            return typeof m === 'string' ? { name: m } : m;
          });
        }
        if (options.dimensions) {
          body.dimensions = options.dimensions.map(function(d) {
            return typeof d === 'string' ? { name: d } : d;
          });
        }
        if (options.dimensionFilter) body.dimensionFilter = options.dimensionFilter;
        if (options.metricFilter) body.metricFilter = options.metricFilter;
        if (options.orderBys) body.orderBys = options.orderBys;
        if (options.limit) body.limit = options.limit;

        return fetchWithRetry(baseUrl() + ':runReport', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body)
        }).then(function(data) {
          cacheSet(NS, 'report_' + key, data);
          return data;
        });
      });
    }

    function getRealtimeReport() {
      return safeCall('GoogleAnalytics.getRealtimeReport', function() {
        var cached = cacheGet(NS, 'realtime');
        if (cached) return Promise.resolve(cached);

        var body = {
          metrics: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' }
          ],
          dimensions: [
            { name: 'unifiedScreenName' }
          ]
        };

        return fetchWithRetry(baseUrl() + ':runRealtimeReport', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body)
        }).then(function(data) {
          cacheSet(NS, 'realtime', data, 30 * 1000); // 30s TTL for realtime
          return data;
        });
      });
    }

    function getChannelPerformance(dateRange) {
      return getReport({
        dateRange: dateRange || { startDate: '30daysAgo', endDate: 'today' },
        metrics: ['sessions', 'totalUsers', 'bounceRate', 'averageSessionDuration', 'conversions'],
        dimensions: ['sessionDefaultChannelGroup']
      });
    }

    function getConversionData(dateRange) {
      return getReport({
        dateRange: dateRange || { startDate: '30daysAgo', endDate: 'today' },
        metrics: ['conversions', 'totalRevenue', 'purchaseRevenue', 'totalUsers'],
        dimensions: ['date', 'eventName']
      });
    }

    return {
      isAvailable: isAvailable,
      getReport: getReport,
      getRealtimeReport: getRealtimeReport,
      getChannelPerformance: getChannelPerformance,
      getConversionData: getConversionData
    };
  })();

  // ---------------------------------------------------------------------------
  // 2. Google Ads API
  // ---------------------------------------------------------------------------

  var GoogleAds = (function() {
    var NS = 'gads';

    function getCustomerId() {
      return getConfig('google.ads.customerId') || getConfig('googleAds.customerId');
    }

    function getAccessToken() {
      return getConfig('google.ads.accessToken') || getConfig('googleAds.accessToken');
    }

    function getDeveloperToken() {
      return getConfig('google.ads.developerToken') || getConfig('googleAds.developerToken');
    }

    function getManagerId() {
      return getConfig('google.ads.managerCustomerId') || getConfig('googleAds.managerCustomerId');
    }

    function searchUrl() {
      return 'https://googleads.googleapis.com/v17/customers/' + getCustomerId() + '/googleAds:search';
    }

    function authHeaders() {
      var headers = {
        'Authorization': 'Bearer ' + getAccessToken(),
        'developer-token': getDeveloperToken(),
        'Content-Type': 'application/json'
      };
      var managerId = getManagerId();
      if (managerId) {
        headers['login-customer-id'] = managerId;
      }
      return headers;
    }

    function isAvailable() {
      return apiEnabled('google.ads') && !!getCustomerId() && !!getAccessToken() && !!getDeveloperToken();
    }

    function gaqlSearch(query, cacheKeyStr, ttl) {
      return safeCall('GoogleAds.search', function() {
        var cached = cacheGet(NS, cacheKeyStr);
        if (cached) return Promise.resolve(cached);

        return fetchWithRetry(searchUrl(), {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ query: query })
        }).then(function(data) {
          cacheSet(NS, cacheKeyStr, data, ttl);
          return data;
        });
      });
    }

    function getCampaigns() {
      var query = 'SELECT campaign.id, campaign.name, campaign.status, ' +
        'campaign.advertising_channel_type, campaign.bidding_strategy_type, ' +
        'campaign_budget.amount_micros ' +
        'FROM campaign WHERE campaign.status != \'REMOVED\' ORDER BY campaign.name';
      return gaqlSearch(query, 'campaigns');
    }

    function getCampaignPerformance(campaignId, dateRange) {
      var start = dateRange ? formatDate(dateRange.start || dateRange.startDate) : '';
      var end = dateRange ? formatDate(dateRange.end || dateRange.endDate) : '';
      var dateClause = '';
      if (start && end) {
        dateClause = ' AND segments.date BETWEEN \'' + start + '\' AND \'' + end + '\'';
      }
      var query = 'SELECT campaign.id, campaign.name, metrics.impressions, ' +
        'metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
        'metrics.conversions_value, metrics.ctr, metrics.average_cpc, ' +
        'segments.date ' +
        'FROM campaign WHERE campaign.id = ' + campaignId + dateClause +
        ' ORDER BY segments.date DESC';
      return gaqlSearch(query, 'camp_perf_' + campaignId + '_' + start + '_' + end);
    }

    function getAdGroups(campaignId) {
      var query = 'SELECT ad_group.id, ad_group.name, ad_group.status, ' +
        'ad_group.type, metrics.impressions, metrics.clicks, metrics.cost_micros ' +
        'FROM ad_group WHERE campaign.id = ' + campaignId +
        ' AND ad_group.status != \'REMOVED\' ORDER BY ad_group.name';
      return gaqlSearch(query, 'adgroups_' + campaignId);
    }

    function getKeywordPerformance(dateRange) {
      var start = dateRange ? formatDate(dateRange.start || dateRange.startDate) : '';
      var end = dateRange ? formatDate(dateRange.end || dateRange.endDate) : '';
      var dateClause = '';
      if (start && end) {
        dateClause = ' AND segments.date BETWEEN \'' + start + '\' AND \'' + end + '\'';
      }
      var query = 'SELECT ad_group_criterion.keyword.text, ' +
        'ad_group_criterion.keyword.match_type, metrics.impressions, ' +
        'metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
        'metrics.ctr, metrics.average_cpc, ad_group_criterion.quality_info.quality_score ' +
        'FROM keyword_view WHERE campaign.status = \'ENABLED\'' + dateClause +
        ' ORDER BY metrics.impressions DESC LIMIT 100';
      return gaqlSearch(query, 'kw_perf_' + start + '_' + end);
    }

    return {
      isAvailable: isAvailable,
      getCampaigns: getCampaigns,
      getCampaignPerformance: getCampaignPerformance,
      getAdGroups: getAdGroups,
      getKeywordPerformance: getKeywordPerformance
    };
  })();

  // ---------------------------------------------------------------------------
  // 3. Meta Ads — Facebook / Instagram Marketing API
  // ---------------------------------------------------------------------------

  var MetaAds = (function() {
    var NS = 'meta';
    var API_VERSION = 'v19.0';
    var BASE = 'https://graph.facebook.com/' + API_VERSION;

    function getAdAccountId() {
      return getConfig('meta.ads.adAccountId') || getConfig('metaAds.adAccountId');
    }

    function getAccessToken() {
      return getConfig('meta.ads.accessToken') || getConfig('metaAds.accessToken');
    }

    function isAvailable() {
      return apiEnabled('meta.ads') && !!getAdAccountId() && !!getAccessToken();
    }

    function metaFetch(endpoint, params, cacheKeyStr, ttl) {
      return safeCall('MetaAds', function() {
        var cached = cacheGet(NS, cacheKeyStr);
        if (cached) return Promise.resolve(cached);

        params = params || {};
        params.access_token = getAccessToken();
        var url = BASE + endpoint + buildQueryString(params);

        return fetchWithRetry(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }).then(function(data) {
          cacheSet(NS, cacheKeyStr, data, ttl);
          return data;
        });
      });
    }

    function getCampaigns() {
      var accountId = getAdAccountId();
      return metaFetch(
        '/act_' + accountId + '/campaigns',
        {
          fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time',
          limit: 100
        },
        'campaigns'
      );
    }

    function getCampaignInsights(campaignId, dateRange) {
      var params = {
        fields: 'impressions,reach,clicks,spend,cpc,cpm,ctr,actions,conversions,cost_per_action_type',
        level: 'campaign'
      };
      if (dateRange) {
        params.time_range = JSON.stringify({
          since: formatDate(dateRange.start || dateRange.startDate),
          until: formatDate(dateRange.end || dateRange.endDate)
        });
      }
      var key = 'insights_' + campaignId + '_' + (dateRange ? JSON.stringify(dateRange) : 'all');
      return metaFetch('/' + campaignId + '/insights', params, key);
    }

    function getAdSets(campaignId) {
      return metaFetch(
        '/' + campaignId + '/adsets',
        {
          fields: 'id,name,status,targeting,daily_budget,lifetime_budget,bid_amount,optimization_goal',
          limit: 100
        },
        'adsets_' + campaignId
      );
    }

    function getAudienceInsights() {
      var accountId = getAdAccountId();
      return metaFetch(
        '/act_' + accountId + '/delivery_estimate',
        {
          fields: 'daily_outcomes_curve,estimate_dau,estimate_mau,estimate_ready',
          optimization_goal: 'REACH',
          targeting_spec: JSON.stringify({ geo_locations: { countries: ['US'] } })
        },
        'audience_insights',
        15 * 60 * 1000
      );
    }

    return {
      isAvailable: isAvailable,
      getCampaigns: getCampaigns,
      getCampaignInsights: getCampaignInsights,
      getAdSets: getAdSets,
      getAudienceInsights: getAudienceInsights
    };
  })();

  // ---------------------------------------------------------------------------
  // 4. Social — Twitter, LinkedIn, TikTok
  // ---------------------------------------------------------------------------

  var Social = (function() {

    // ---- Twitter / X ----
    var twitter = (function() {
      var NS = 'tw';
      var BASE = 'https://api.twitter.com/2';

      function getBearerToken() {
        return getConfig('social.twitter.bearerToken') || getConfig('twitter.bearerToken');
      }

      function getUserId() {
        return getConfig('social.twitter.userId') || getConfig('twitter.userId');
      }

      function isAvailable() {
        return apiEnabled('social.twitter') && !!getBearerToken() && !!getUserId();
      }

      function twitterFetch(endpoint, params, cacheKeyStr, ttl) {
        return safeCall('Social.twitter', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          var url = BASE + endpoint + buildQueryString(params || {});
          return fetchWithRetry(url, {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + getBearerToken(),
              'Content-Type': 'application/json'
            }
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl);
            return data;
          });
        });
      }

      function getMetrics() {
        var userId = getUserId();
        return twitterFetch(
          '/users/' + userId + '/tweets',
          {
            'tweet.fields': 'public_metrics,created_at,organic_metrics',
            max_results: 100
          },
          'metrics'
        );
      }

      function getFollowers() {
        var userId = getUserId();
        return twitterFetch(
          '/users/' + userId,
          { 'user.fields': 'public_metrics,created_at,description' },
          'followers',
          10 * 60 * 1000
        );
      }

      return {
        isAvailable: isAvailable,
        getMetrics: getMetrics,
        getFollowers: getFollowers
      };
    })();

    // ---- LinkedIn ----
    var linkedin = (function() {
      var NS = 'li';
      var BASE = 'https://api.linkedin.com/v2';

      function getAccessToken() {
        return getConfig('social.linkedin.accessToken') || getConfig('linkedin.accessToken');
      }

      function getOrganizationId() {
        return getConfig('social.linkedin.organizationId') || getConfig('linkedin.organizationId');
      }

      function isAvailable() {
        return apiEnabled('social.linkedin') && !!getAccessToken() && !!getOrganizationId();
      }

      function linkedinFetch(endpoint, params, cacheKeyStr, ttl) {
        return safeCall('Social.linkedin', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          var url = BASE + endpoint + buildQueryString(params || {});
          return fetchWithRetry(url, {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + getAccessToken(),
              'Content-Type': 'application/json',
              'X-Restli-Protocol-Version': '2.0.0'
            }
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl);
            return data;
          });
        });
      }

      function getOrganizationStats() {
        var orgId = getOrganizationId();
        return linkedinFetch(
          '/organizationalEntityShareStatistics',
          { q: 'organizationalEntity', organizationalEntity: 'urn:li:organization:' + orgId },
          'org_stats',
          10 * 60 * 1000
        );
      }

      function getShareStats() {
        var orgId = getOrganizationId();
        return linkedinFetch(
          '/shares',
          { q: 'owners', owners: 'urn:li:organization:' + orgId, count: 50 },
          'share_stats'
        );
      }

      return {
        isAvailable: isAvailable,
        getOrganizationStats: getOrganizationStats,
        getShareStats: getShareStats
      };
    })();

    // ---- TikTok ----
    var tiktok = (function() {
      var NS = 'tt';
      var BASE = 'https://open.tiktokapis.com/v2';

      function getAccessToken() {
        return getConfig('social.tiktok.accessToken') || getConfig('tiktok.accessToken');
      }

      function isAvailable() {
        return apiEnabled('social.tiktok') && !!getAccessToken();
      }

      function tiktokFetch(endpoint, params, cacheKeyStr, ttl) {
        return safeCall('Social.tiktok', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          var url = BASE + endpoint + buildQueryString(params || {});
          return fetchWithRetry(url, {
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + getAccessToken(),
              'Content-Type': 'application/json'
            }
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl);
            return data;
          });
        });
      }

      function getVideoStats() {
        return tiktokFetch(
          '/video/list/',
          { fields: 'id,title,create_time,like_count,comment_count,share_count,view_count,duration' },
          'video_stats'
        );
      }

      return {
        isAvailable: isAvailable,
        getVideoStats: getVideoStats
      };
    })();

    return {
      twitter: twitter,
      linkedin: linkedin,
      tiktok: tiktok
    };
  })();

  // ---------------------------------------------------------------------------
  // 5. Email Marketing — Mailchimp, SendGrid
  // ---------------------------------------------------------------------------

  var EmailMarketing = (function() {

    // ---- Mailchimp ----
    var mailchimp = (function() {
      var NS = 'mc';

      function getApiKey() {
        return getConfig('email.mailchimp.apiKey') || getConfig('mailchimp.apiKey');
      }

      function getServer() {
        var key = getApiKey();
        if (!key) return 'us1';
        var parts = key.split('-');
        return parts.length > 1 ? parts[parts.length - 1] : 'us1';
      }

      function baseUrl() {
        return 'https://' + getServer() + '.api.mailchimp.com/3.0';
      }

      function isAvailable() {
        return apiEnabled('email.mailchimp') && !!getApiKey();
      }

      function mcFetch(endpoint, params, cacheKeyStr, ttl) {
        return safeCall('EmailMarketing.mailchimp', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          return fetchWithRetry('/api/integration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: 'mailchimp', endpoint: endpoint, params: params || {}, method: 'GET' })
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl);
            return data;
          });
        });
      }

      function getCampaigns() {
        return mcFetch(
          '/campaigns',
          { count: 50, sort_field: 'send_time', sort_dir: 'DESC' },
          'campaigns'
        );
      }

      function getListStats() {
        return mcFetch('/lists', { count: 50 }, 'lists', 10 * 60 * 1000);
      }

      function getCampaignReport(campaignId) {
        return mcFetch(
          '/reports/' + campaignId,
          {},
          'report_' + campaignId,
          10 * 60 * 1000
        );
      }

      return {
        isAvailable: isAvailable,
        getCampaigns: getCampaigns,
        getListStats: getListStats,
        getCampaignReport: getCampaignReport
      };
    })();

    // ---- Resend ----
    var resend = (function() {
      var NS = 'resend';

      function isAvailable() {
        // Resend credentials live server-side only; always reachable via /api/integration
        return apiEnabled('email.resend') !== false;
      }

      function resendFetch(endpoint, params, cacheKeyStr, ttl) {
        return safeCall('EmailMarketing.resend', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          return fetchWithRetry('/api/integration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: 'resend', endpoint: endpoint, params: params || {}, method: 'GET' })
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl);
            return data;
          });
        });
      }

      // List sent emails (Resend GET /emails)
      function getEmails(params) {
        var key = 'emails_' + JSON.stringify(params || {});
        return resendFetch('/emails', params || {}, key, 5 * 60 * 1000);
      }

      // Fetch single email by Resend ID
      function getEmail(id) {
        return resendFetch('/emails/' + id, {}, 'email_' + id, 5 * 60 * 1000);
      }

      return {
        isAvailable: isAvailable,
        getEmails:   getEmails,
        getEmail:    getEmail,
      };
    })();

    return {
      mailchimp: mailchimp,
      resend:    resend,
      // Legacy alias so existing callers referencing .sendgrid still resolve
      sendgrid:  resend,
    };
  })();

  // ---------------------------------------------------------------------------
  // 6. SEO Tools — Ahrefs, SEMrush, DataForSEO
  // ---------------------------------------------------------------------------

  var SEOTools = (function() {

    // ---- Ahrefs ----
    var ahrefs = (function() {
      var NS = 'ahrefs';
      var BASE = 'https://apiv2.ahrefs.com';

      function getApiToken() {
        return getConfig('seo.ahrefs.apiToken')
            || getConfig('ahrefs.apiToken')
            || getProjectIntegrationValue('ahrefs', ['apiToken', 'apiKey', 'API Key', 'token']);
      }

      function isAvailable() {
        return !!getApiToken();
      }

      function ahrefsFetch(endpoint, params, cacheKeyStr, ttl) {
        return safeCall('SEOTools.ahrefs', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          return fetchWithRetry('/api/integration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: 'ahrefs', endpoint: endpoint || '/', params: params || {}, method: 'GET' })
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl || 30 * 60 * 1000);
            return data;
          });
        });
      }

      function getBacklinks(target) {
        return ahrefsFetch('/', {
          from: 'backlinks',
          target: target,
          mode: 'domain',
          limit: 100,
          order_by: 'domain_rating:desc'
        }, 'backlinks_' + target);
      }

      function getKeywordData(keywords) {
        var keywordList = Array.isArray(keywords) ? keywords.join(',') : keywords;
        return ahrefsFetch('/', {
          from: 'keywords_explorer',
          keywords: keywordList,
          country: 'us'
        }, 'keywords_' + keywordList);
      }

      function getDomainRating(domain) {
        return ahrefsFetch('/', {
          from: 'domain_rating',
          target: domain,
          mode: 'domain'
        }, 'dr_' + domain, 60 * 60 * 1000);
      }

      return {
        isAvailable: isAvailable,
        getBacklinks: getBacklinks,
        getKeywordData: getKeywordData,
        getDomainRating: getDomainRating
      };
    })();

    // ---- SEMrush ----
    var semrush = (function() {
      var NS = 'semrush';
      var BASE = 'https://api.semrush.com';

      function getApiKey() {
        return getConfig('seo.semrush.apiKey')
            || getConfig('semrush.apiKey')
            || getProjectIntegrationValue('semrush', ['apiKey', 'API Key', 'token']);
      }

      function isAvailable() {
        return !!getApiKey();
      }

      function semrushFetch(params, cacheKeyStr, ttl) {
        return safeCall('SEOTools.semrush', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          return fetchWithRetry('/api/integration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: 'semrush', endpoint: '/', params: params || {}, method: 'GET' })
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl || 30 * 60 * 1000);
            return data;
          });
        });
      }

      function getOrganicKeywords(domain) {
        return semrushFetch({
          type: 'domain_organic',
          domain: domain,
          database: 'us',
          display_limit: 100,
          export_columns: 'Ph,Po,Nq,Cp,Ur,Tr,Tc,Co,Nr'
        }, 'organic_' + domain);
      }

      function getBacklinks(domain) {
        return semrushFetch({
          type: 'backlinks_overview',
          target: domain,
          target_type: 'root_domain',
          export_columns: 'total,domains_num,urls_num,ips_num,follows_num,nofollows_num,texts_num,images_num'
        }, 'backlinks_' + domain);
      }

      return {
        isAvailable: isAvailable,
        getOrganicKeywords: getOrganicKeywords,
        getBacklinks: getBacklinks
      };
    })();

    // ---- DataForSEO (within SEOTools) ----
    var dataforseo = (function() {
      var NS = 'dfs_seo';
      var BASE = 'https://api.dataforseo.com/v3';

      function getLogin() {
        return getConfig('seo.dataforseo.login') || getConfig('dataforseo.login');
      }

      function getPassword() {
        return getConfig('seo.dataforseo.password') || getConfig('dataforseo.password');
      }

      function isAvailable() {
        return apiEnabled('seo.dataforseo') && !!getLogin() && !!getPassword();
      }

      function authHeader() {
        return 'Basic ' + btoa(getLogin() + ':' + getPassword());
      }

      function dfsFetch(endpoint, body, cacheKeyStr, ttl) {
        return safeCall('SEOTools.dataforseo', function() {
          var cached = cacheGet(NS, cacheKeyStr);
          if (cached) return Promise.resolve(cached);

          return fetchWithRetry('/api/integration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: 'dataforseo', endpoint: endpoint, method: 'POST', body: body })
          }).then(function(data) {
            cacheSet(NS, cacheKeyStr, data, ttl || 30 * 60 * 1000);
            return data;
          });
        });
      }

      function getSerpResults(keyword) {
        return dfsFetch('/serp/google/organic/live/advanced', [{
          keyword: keyword,
          location_code: 2840,
          language_code: 'en',
          device: 'desktop',
          os: 'windows',
          depth: 20
        }], 'serp_' + keyword);
      }

      function getKeywordData(keywords) {
        var items = Array.isArray(keywords) ? keywords : [keywords];
        return dfsFetch('/keywords_data/google_ads/search_volume/live', [{
          keywords: items,
          location_code: 2840,
          language_code: 'en'
        }], 'kwdata_' + items.join('_'));
      }

      return {
        isAvailable: isAvailable,
        getSerpResults: getSerpResults,
        getKeywordData: getKeywordData
      };
    })();

    return {
      ahrefs: ahrefs,
      semrush: semrush,
      dataforseo: dataforseo
    };
  })();

  // ---------------------------------------------------------------------------
  // 7. DataForSEO — Top-level, full-featured module
  // ---------------------------------------------------------------------------

  var DataForSEO = (function() {
    var NS = 'dfs';
    var BASE = 'https://api.dataforseo.com/v3';

    function getLogin() {
      return getConfig('dataforseo.login') || getConfig('seo.dataforseo.login');
    }

    function getPassword() {
      return getConfig('dataforseo.password') || getConfig('seo.dataforseo.password');
    }

    function isAvailable() {
      return (apiEnabled('dataforseo') || apiEnabled('seo.dataforseo')) && !!getLogin() && !!getPassword();
    }

    function authHeader() {
      return 'Basic ' + btoa(getLogin() + ':' + getPassword());
    }

    function dfsFetch(endpoint, body, cacheKeyStr, ttl) {
      return safeCall('DataForSEO', function() {
        var cached = cacheGet(NS, cacheKeyStr);
        if (cached) return Promise.resolve(cached);

        return fetchWithRetry(BASE + endpoint, {
          method: 'POST',
          headers: {
            'Authorization': authHeader(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }).then(function(data) {
          cacheSet(NS, cacheKeyStr, data, ttl || 30 * 60 * 1000);
          return data;
        });
      });
    }

    function getRankings(keywords, location) {
      var items = Array.isArray(keywords) ? keywords : [keywords];
      var locationCode = location || 2840; // default US
      var tasks = items.map(function(kw) {
        return {
          keyword: kw,
          location_code: locationCode,
          language_code: 'en',
          device: 'desktop',
          os: 'windows',
          depth: 100
        };
      });
      return dfsFetch(
        '/serp/google/organic/live/advanced',
        tasks,
        'rankings_' + items.join('|') + '_' + locationCode
      );
    }

    function getKeywordMetrics(keywords) {
      var items = Array.isArray(keywords) ? keywords : [keywords];
      return dfsFetch(
        '/keywords_data/google_ads/search_volume/live',
        [{
          keywords: items,
          location_code: 2840,
          language_code: 'en',
          sort_by: 'search_volume'
        }],
        'kw_metrics_' + items.join('|')
      );
    }

    function getBacklinks(target) {
      return dfsFetch(
        '/backlinks/summary/live',
        [{
          target: target,
          internal_list_limit: 0,
          include_subdomains: true
        }],
        'bl_' + target,
        60 * 60 * 1000
      );
    }

    function getOnPageAnalysis(url) {
      return safeCall('DataForSEO.getOnPageAnalysis', function() {
        var cached = cacheGet(NS, 'onpage_' + url);
        if (cached) return Promise.resolve(cached);

        // Step 1: Create a task
        return dfsFetch(
          '/on_page/task_post',
          [{
            target: url,
            max_crawl_pages: 50,
            load_resources: true,
            enable_javascript: true,
            enable_browser_rendering: true
          }],
          null // do not cache intermediate
        ).then(function(taskResponse) {
          if (!taskResponse || !taskResponse.tasks || !taskResponse.tasks[0]) {
            return null;
          }
          var taskId = taskResponse.tasks[0].id;

          // Step 2: Poll for results (simplified — single check after delay)
          return wait(15000).then(function() {
            return fetchWithRetry(BASE + '/on_page/summary/' + taskId, {
              method: 'GET',
              headers: {
                'Authorization': authHeader(),
                'Content-Type': 'application/json'
              }
            });
          }).then(function(data) {
            cacheSet(NS, 'onpage_' + url, data, 60 * 60 * 1000);
            return data;
          });
        });
      });
    }

    return {
      isAvailable: isAvailable,
      getRankings: getRankings,
      getKeywordMetrics: getKeywordMetrics,
      getBacklinks: getBacklinks,
      getOnPageAnalysis: getOnPageAnalysis
    };
  })();

  // ---------------------------------------------------------------------------
  // 9. AI Video Generation — Tavus, HeyGen, Synthesia
  // ---------------------------------------------------------------------------

  var VideoGeneration = (function() {
    // ----- Tavus API (AI-generated personalized videos) -----
    var TavusAPI = (function() {
      var NS = 'tavus';

      function isAvailable() {
        return apiEnabled('video.tavus');
      }

      function authHeader() {
        var apiKey = getConfig('video.tavus.apiKey');
        if (!apiKey) throw new Error('Tavus API key not configured');
        return 'Bearer ' + apiKey;
      }

      function tavusFetch(endpoint, body, cacheKey, ttl) {
        return safeCall('Tavus.' + endpoint, function() {
          if (cacheKey) {
            var cached = cacheGet(NS, cacheKey);
            if (cached) return Promise.resolve(cached);
          }

          var url = 'https://tavusapi.com/v2' + endpoint;
          return fetchWithRetry(url, {
            method: 'POST',
            headers: {
              'x-api-key': authHeader().replace('Bearer ', ''),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          }).then(function(data) {
            if (cacheKey && ttl) {
              cacheSet(NS, cacheKey, data, ttl);
            }
            return data;
          });
        });
      }

      function createVideo(options) {
        var scriptContent = options.script || '';
        var avatarId = options.avatar_id || null;
        var voiceId = options.voice_id || null;
        var backgroundUrl = options.background_url || null;

        return tavusFetch('/videos', {
          script: scriptContent,
          avatar_id: avatarId,
          voice_id: voiceId,
          background_source_url: backgroundUrl
        });
      }

      function getVideoStatus(videoId) {
        return safeCall('Tavus.getVideoStatus', function() {
          var url = 'https://tavusapi.com/v2/videos/' + videoId;
          return fetchWithRetry(url, {
            method: 'GET',
            headers: {
              'x-api-key': authHeader().replace('Bearer ', '')
            }
          });
        });
      }

      function listAvatars() {
        return safeCall('Tavus.listAvatars', function() {
          var cached = cacheGet(NS, 'avatars_list');
          if (cached) return Promise.resolve(cached);

          var url = 'https://tavusapi.com/v2/avatars';
          return fetchWithRetry(url, {
            method: 'GET',
            headers: {
              'x-api-key': authHeader().replace('Bearer ', '')
            }
          }).then(function(data) {
            cacheSet(NS, 'avatars_list', data, 24 * 60 * 60 * 1000); // 24 hour cache
            return data;
          });
        });
      }

      return {
        isAvailable: isAvailable,
        createVideo: createVideo,
        getVideoStatus: getVideoStatus,
        listAvatars: listAvatars
      };
    })();

    return {
      tavus: TavusAPI
    };
  })();

  // ---------------------------------------------------------------------------
  // Utility: list all configured integrations
  // ---------------------------------------------------------------------------

  function getAvailableIntegrations() {
    var integrations = [];

    if (GoogleAnalytics.isAvailable()) integrations.push('GoogleAnalytics');
    if (GoogleAds.isAvailable()) integrations.push('GoogleAds');
    if (MetaAds.isAvailable()) integrations.push('MetaAds');
    if (Social.twitter.isAvailable()) integrations.push('Social.twitter');
    if (Social.linkedin.isAvailable()) integrations.push('Social.linkedin');
    if (Social.tiktok.isAvailable()) integrations.push('Social.tiktok');
    if (EmailMarketing.mailchimp.isAvailable()) integrations.push('EmailMarketing.mailchimp');
    if (EmailMarketing.resend.isAvailable())   integrations.push('EmailMarketing.resend');
    if (SEOTools.ahrefs.isAvailable()) integrations.push('SEOTools.ahrefs');
    if (SEOTools.semrush.isAvailable()) integrations.push('SEOTools.semrush');
    if (SEOTools.dataforseo.isAvailable()) integrations.push('SEOTools.dataforseo');
    if (DataForSEO.isAvailable()) integrations.push('DataForSEO');
    if (VideoGeneration.tavus.isAvailable()) integrations.push('VideoGeneration.tavus');

    return integrations;
  }

  // ---------------------------------------------------------------------------
  // Expose public API
  // ---------------------------------------------------------------------------

  window.ApiConnector = {
    GoogleAnalytics: GoogleAnalytics,
    GoogleAds: GoogleAds,
    MetaAds: MetaAds,
    Social: Social,
    EmailMarketing: EmailMarketing,
    SEOTools: SEOTools,
    DataForSEO: DataForSEO,
    VideoGeneration: VideoGeneration,
    getAvailableIntegrations: getAvailableIntegrations
  };

})();
