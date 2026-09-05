/**
 * Fixture site reproducing the exact Webese scenario the audit got wrong,
 * plus a stub of /api/fetch-page so seo-audit.js runs unmodified.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');

// A page that looks like a real Next.js SSR page: hand-written title + meta
// description, async analytics, GTM inline snippet, theme-flash guard,
// external links with rel="noreferrer", real H1.
function page({ title, desc, h1, body }) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="/og.png">
<link rel="canonical" href="https://example.test/">
<script>(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}})();</script>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-XXXX');</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
</head><body>
<h1>${h1}</h1>
${body}
<a href="https://github.com/example" target="_blank" rel="noreferrer">GitHub</a>
<a href="https://twitter.com/example" target="_blank" rel="noreferrer">Twitter</a>
<a href="https://partner.example.com">A plain external link, same tab</a>
</body></html>`;
}

const PAGES = {
  '/': page({
    title: 'Webese — Build sites with AI',
    desc: 'Webese builds and ships production websites for you, using AI agents that write real code, not templates. Try it free today.',
    h1: 'Build your site with AI',
    body: '<p>' + 'Real marketing copy here. '.repeat(40) + '</p><p>More content.</p><p>Even more.</p>' +
          '<a href="/about">About</a> <a href="/terms">Terms</a> <a href="/build">Build</a> <a href="/dashboard">Dashboard</a> <a href="/changelog">Changelog</a> <a href="/genuinely-broken">Broken</a>',
  }),
  '/about': page({
    title: 'About | Webese.ai',
    desc: 'Meet the team behind Webese and read why we set out to replace website templates with AI agents that write real production code.',
    h1: 'About Webese',
    body: '<p>' + 'About us copy. '.repeat(30) + '</p><p>Second para.</p><p>Third para.</p>',
  }),
  // 28 chars — the exact case that used to trip "Title tag too short"
  '/terms': page({
    title: 'Terms of Service | Webese.ai',
    desc: 'The terms and conditions governing your use of Webese, including acceptable use, billing, and account termination.',
    h1: 'Terms of Service',
    body: '<p>' + 'Legal text. '.repeat(60) + '</p><p>More legal.</p><p>Yet more.</p>',
  }),
  // Short by genre — should NOT be flagged as thin content
  '/changelog': page({
    title: 'Changelog | Webese.ai',
    desc: 'Every release of Webese, newest first, with the fixes and features that shipped in each one.',
    h1: 'Changelog',
    body: '<p>v1.2 — faster builds.</p><p>v1.1 — new templates.</p><p>v1.0 — launch.</p>',
  }),

  // ── Control page: a page with GENUINE problems. Proves the recalibrated
  // checks still fire, i.e. the false positives were fixed by reading the
  // page correctly, not by turning the checks off.
  '/genuinely-broken': `<!DOCTYPE html><html><head>
<title>Buy</title>
<script src="https://cdn.example.com/a.js"></script>
<script src="https://cdn.example.com/b.js"></script>
<script src="https://cdn.example.com/c.js"></script>
</head><body>
<h2>No h1 here</h2>
<p>Tiny.</p>
<a href="https://evil.example.com" target="_blank">Unprotected new-tab link</a>
</body></html>`,
  // The auth-gated redirect target. All three of /login /build /dashboard
  // serve this one page.
  '/login': page({
    title: 'Log in | Webese.ai',
    desc: 'Log in to your Webese account.',
    h1: 'Log in',
    body: '<p>Enter your email to continue.</p>',
  }),
};

const ROBOTS = `User-agent: *
Disallow: /build
Disallow: /dashboard
Disallow: /admin/

Sitemap: http://HOST/sitemap.xml
`;

function resolvePath(p) {
  // /build and /dashboard redirect to /login, like the real site
  if (p === '/build' || p === '/dashboard') return { redirectTo: '/login' };
  if (PAGES[p]) return { html: PAGES[p] };
  return null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${server.address().port}`);
  const p = u.pathname;

  // Serve the harness page + the real audit script under test
  if (p === '/harness.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'harness.html'), 'utf8'));
  }
  if (p === '/seo-audit.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(REPO, 'web/js/seo-audit.js'), 'utf8'));
  }

  // Stub of the app's own /api/fetch-page: follows redirects, reports finalUrl
  if (p === '/api/fetch-page' && req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      let target;
      try { target = new URL(JSON.parse(body).url); } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'bad url' }));
      }
      let pathname = target.pathname;
      let finalUrl = target.toString();

      if (pathname === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          success: true, status: 200, finalUrl,
          html: ROBOTS.replace('HOST', target.host),
        }));
      }

      const hit = resolvePath(pathname);
      if (hit && hit.redirectTo) {
        pathname = hit.redirectTo;
        finalUrl = new URL(pathname, target).toString();
      }
      const resolved = PAGES[pathname];
      if (!resolved) {
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'HTTP 404' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, html: resolved, status: 200, finalUrl }));
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(0, () => {
  console.log('PORT=' + server.address().port);
});
