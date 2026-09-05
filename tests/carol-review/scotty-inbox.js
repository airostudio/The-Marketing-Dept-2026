const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const REPO=path.resolve(__dirname,'../..');

// Pre-seed a queued item, as Carol would have left it.
const QUEUED=[{id:'rev1',dedupeKey:'social_posts:p1',section:'Needs your decision',agentKey:'social',
  type:'needs_approval',title:'Review social post: Cut your status meetings in half',
  snapshot:'Platform: LinkedIn\nHeadline: Cut your status meetings in half\nBody: The ones that shipped fastest replaced standups with a written daily log.',
  payload:null,sourceRef:{store:'social_posts',id:'p1'},link:'/agents/social-agent.html?post=p1',
  priority:'high',status:'pending',verdict:null,reasoning:null,reviewedAt:null,decidedAt:null,
  sentAt:new Date().toISOString()}];

const server=http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  if(u==='/scotty.html'){
    let html=fs.readFileSync(path.join(REPO,'web/scotty.html'),'utf8');
    html=html.split('<script src="/js/social-posts-store.js"></script>').join('');
    html=html.replace('<script src="/js/review-queue.js"></script>',
      `<script>try{localStorage.setItem('audema_review_queue',${JSON.stringify(JSON.stringify(QUEUED))});}catch(e){}</script>
       <script src="/js/review-queue.js"></script>
       <script>
         window.SocialPostsStore={updateStatus:async(id,status,note)=>{
           window.__wb=window.__wb||[];window.__wb.push({id,status,note});return true;}};
         window.ClaudeService={callAgent:async({messages})=>{window.__prompt=messages[0].content;
           return 'VERDICT: approve\\nREASON: Concrete proof point and the CTA matches the offer. Ship it.';}};
       </script>`);
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
  p.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log('[c]',m.text().slice(0,200));});
  const fail=[];const check=(n,c)=>{console.log((c?'  PASS  ':'  FAIL  ')+n);if(!c)fail.push(n);};

  // ?review=1 is the link Carol hands over.
  await p.goto(`http://localhost:${port}/scotty.html?review=1`);
  await p.waitForTimeout(900);

  const r=await p.evaluate(()=>({
    badgeVisible:getComputedStyle(document.getElementById('reviewInboxBtn')).display!=='none',
    badgeCount:document.getElementById('reviewInboxCount').textContent,
    modalOpen:document.getElementById('reviewModalOverlay').classList.contains('visible'),
    snapshotShown:document.querySelector('.review-snapshot')?.textContent||'',
    hasApprove:!!document.querySelector('.review-btn.approve'),
  }));
  console.log('badge:',r.badgeCount,'| modal open:',r.modalOpen);
  check('topbar badge shows the queued count',r.badgeVisible&&r.badgeCount==='1');
  check('?review=1 from Carol opens the inbox',r.modalOpen);
  check('inbox shows the real content, not just a title',r.snapshotShown.includes('written daily log'));
  check('approve/reject controls present',r.hasApprove);

  // Scotty reviews
  await p.click('#btnReviewAll');
  await p.waitForTimeout(600);
  const rev=await p.evaluate(()=>({
    prompt:window.__prompt||'',
    verdictShown:document.querySelector('.review-verdict')?.textContent||'',
    cls:document.querySelector('.review-verdict')?.className||'',
    status:window.ReviewQueue.get('rev1').status,
  }));
  check('Scotty was given the actual content to judge',rev.prompt.includes('written daily log'));
  check('verdict rendered with reasoning',/Ship it/.test(rev.verdictShown));
  check('verdict styled as an approval',/approve/.test(rev.cls));
  check('reviewed but NOT auto-decided',rev.status==='reviewed');

  // Owner approves
  const pre=await p.evaluate(()=>({hasStore:!!window.SocialPostsStore,hasUpd:typeof window.SocialPostsStore?.updateStatus,
    ref:JSON.stringify(window.ReviewQueue.get('rev1').sourceRef)}));
  console.log('PRE-DECIDE',JSON.stringify(pre));
  await p.click('.review-btn.approve');
  await p.waitForTimeout(800);
  const dec=await p.evaluate(()=>({
    status:window.ReviewQueue.get('rev1').status,
    writeBack:window.__wb||[],
    badge:getComputedStyle(document.getElementById('reviewInboxBtn')).display,
    decidedLabel:document.querySelector('.review-decided')?.textContent||'',
  }));
  check("owner's approval records the decision",dec.status==='approved');
  check('approval written back to the real post',
    dec.writeBack.length===1&&dec.writeBack[0].id==='p1'&&dec.writeBack[0].status==='approved');
  check('write-back carries Scotty reasoning as the review note',/Ship it/.test(dec.writeBack[0].note||''));
  check('badge clears once nothing is pending',dec.badge==='none');
  check('item shows as approved',/Approved/.test(dec.decidedLabel));
  check('no JS errors',errs.length===0);
  if(errs.length)console.log('  errors:',errs.slice(0,3));

  console.log('\n'+(fail.length===0?'ALL ASSERTIONS PASSED':`${fail.length} FAILED: ${fail.join(' | ')}`));
  await b.close();server.close();process.exit(fail.length?1:0);
});
