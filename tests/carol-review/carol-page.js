const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const REPO=path.resolve(__dirname,'../..');
const POST={id:'p1',source:'organic',platform:'LinkedIn',hook:'Hook line',headline:'Cut your status meetings in half',
 body:'The ones that shipped fastest replaced standups with a written daily log.',cta:'Grab the template',
 hashtags:['ops'],status:'pending_review',created_at:new Date().toISOString()};

const server=http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  if(u==='/agents/carol-agent.html'){
    let html=fs.readFileSync(path.join(REPO,'web/agents/carol-agent.html'),'utf8');
    // Inject stubs before the stores load so the page runs offline.
    // Inject AFTER the real store scripts, or they overwrite the stubs.
    html=html.replace('<script src="/js/carol-aggregator.js"></script>', `<script>
      window.SocialPostsStore={listPosts:async()=>[${JSON.stringify(POST)}]};
      window.AgentHistory={getAll:()=>[]};
      window.SEOPipelineStore=null; window.IntelligenceEngine=null;
    </script>\n<script src="/js/carol-aggregator.js"></script>`);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html);
  }
  const m=u.match(/^\/js\/([\w.-]+)$/);
  if(m){const f=path.join(REPO,'web/js',m[1]);
    if(fs.existsSync(f)){res.writeHead(200,{'content-type':'application/javascript; charset=utf-8'});return res.end(fs.readFileSync(f,'utf8'));}
    res.writeHead(200,{'content-type':'application/javascript'});return res.end('');}
  res.writeHead(404);res.end();
});

server.listen(0,async()=>{
  const port=server.address().port;
  const b=await chromium.launch();const p=await b.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://localhost:${port}/agents/carol-agent.html`);
  p.on('console',m=>console.log('[console]',m.type(),m.text().slice(0,200)));
  await p.waitForSelector('.item-card',{timeout:5000}).catch(()=>{});
  const dbg=await p.evaluate(()=>({
    loading:document.getElementById('loading-row')?.textContent.trim().slice(0,200),
    contentDisplay:document.getElementById('content')?.style.display,
    contentHtml:(document.getElementById('content')?.innerHTML||'').slice(0,200),
    hasAgg:!!window.CarolAggregator, hasRQ:!!window.ReviewQueue,
  }));
  console.log('DEBUG',JSON.stringify(dbg,null,1));

  const fail=[];const check=(n,c)=>{console.log((c?'  PASS  ':'  FAIL  ')+n);if(!c)fail.push(n);};

  const r=await p.evaluate(()=>({
    cards:document.querySelectorAll('.item-card').length,
    previewText:document.querySelector('.item-preview')?.textContent||'',
    previewVisible:document.querySelector('.item-preview')?.classList.contains('open'),
    sendBtn:document.querySelector('.send-scotty-btn')?.textContent.trim()||'',
  }));
  console.log('cards:',r.cards,'| send button:',JSON.stringify(r.sendBtn));

  check('a card rendered',r.cards>=1);
  check('preview holds the real post body',r.previewText.includes('written daily log'));
  check('preview starts collapsed',r.previewVisible===false);
  check('section has a Send-all-to-Scotty button',/Send all 1 to Scotty for review/.test(r.sendBtn));

  // Expand the preview
  await p.click('.preview-toggle');
  const after=await p.evaluate(()=>({
    open:document.querySelector('.item-preview').classList.contains('open'),
    btn:document.querySelector('.preview-toggle').textContent.trim(),
  }));
  check('View expands the preview',after.open===true&&after.btn==='Hide');

  // Send the section to Scotty
  await p.click('.send-scotty-btn');
  const sent=await p.evaluate(()=>({
    btn:document.querySelector('.send-scotty-btn').textContent.trim(),
    note:document.querySelector('.send-scotty-note').textContent.trim(),
    queued:window.ReviewQueue.pendingCount(),
    snapshot:(window.ReviewQueue.open()[0]||{}).snapshot||'',
    badge:document.getElementById('review-inbox-link').textContent.trim(),
  }));
  console.log('after send →',JSON.stringify(sent.btn),'|',sent.note);
  check('button confirms what was sent',/Sent 1 to Scotty/.test(sent.btn));
  check('item landed in the queue',sent.queued===1);
  check('queued snapshot carries the real content',sent.snapshot.includes('written daily log'));
  check('nav badge shows what is with Scotty',/1 with Scotty/.test(sent.badge));
  check('no JS errors',errs.length===0);
  if(errs.length)console.log('  errors:',errs);

  console.log('\n'+(fail.length===0?'ALL ASSERTIONS PASSED':`${fail.length} FAILED: ${fail.join(' | ')}`));
  await b.close();server.close();process.exit(fail.length?1:0);
});
