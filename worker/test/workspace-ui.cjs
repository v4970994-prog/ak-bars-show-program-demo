// Two authenticated, already-open clients against the real Worker and SQLite.
// Only message delivery and network timing/failure are replaced; no external requests.
const assert=require('node:assert/strict'),{chromium}=require('playwright'),fixture=require('./employee-fixture.cjs');
(async()=>{
 const {db,c,env,response,call}=await fixture(),html=await(await c.worker.fetch(new Request('https://local.test/'),env)).text();
 const executable=process.env.CHROMIUM_EXECUTABLE,browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 const errors=[],clients=[];
 const waitFor=async(fn)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25))}throw new Error('Timed out waiting for network condition')};
 async function client(id,url='?browser=1'){
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Europe/Moscow',locale:'ru-RU'}),control={reads:0,fail:false,hold:false,held:[],pauseWrite:false,writes:[],page};clients.push(control);
  await page.clock.install({time:new Date('2026-10-26T09:00:00Z')});
  await page.addInitScript(token=>localStorage.setItem('akbars_web_token',token),'local-token-'+id);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   if(p==='/')return route.fulfill({contentType:'text/html',body:html});
   if(p.startsWith('/api/')){
    if(p==='/api/workspace'){control.reads++;if(control.fail)return route.fulfill({status:503,json:{ok:false,error:'Temporary local failure'}})}
    if(p==='/api/calculations/action'&&control.pauseWrite){control.pauseWrite=false;await new Promise(resolve=>control.writes.push(resolve))}
    const r=await response(p,req.postDataJSON()),options={status:r.status,contentType:'application/json',body:await r.text()};
    if(p==='/api/workspace'&&control.hold){control.hold=false;await new Promise(resolve=>control.held.push(resolve))}
    return route.fulfill(options);
   }
   return route.fulfill({contentType:'application/javascript',body:''});
  });
  await page.goto('https://local.test/'+url);await page.locator('#shell:not(.hidden)').waitFor();return control;
 }
 const section=page=>page.locator('.section.active').getAttribute('id');
 const nav=async(page,id)=>{await page.locator('.nav-btn[data-go="'+id+'"]').click();await page.waitForFunction(()=>document.querySelector('#workspaceSync').dataset.status!=='loading')};
 const approvalCount=p=>p.locator('#approvalsList .calculation-card').count();
 async function create(event='event'){
  const r=await call('/api/calculations/save',{eventId:'draft:'+event,eventTitle:'Урок хоккея '+event,items:[{id:'custom:lead',custom:true,name:'Ведущий',unit:'усл.',qty:1,unitPrice:1000}]});
  assert.equal(r.httpStatus,200,JSON.stringify(r));return r.id;
 }
 async function send(id){const r=await call('/api/calculations/action',{id,action:'send_approval'});assert.equal(r.httpStatus,200,JSON.stringify(r))}
 try{
  const owner=await client('vil'),p=owner.page,gleb=await client('gleb','?browser=1&section=approvals'),g=gleb.page;
  assert.equal(await section(p),'home');assert.equal(await section(g),'approvals');assert.equal(await approvalCount(g),0);
  // The page predates the employee's new calculation and notification.
  const first=await create();await send(first);assert.equal(c.sent.at(-1).id,'vil');
  const reads=owner.reads;await nav(p,'approvals');assert.ok(owner.reads>reads);assert.equal(await approvalCount(p),1);
  assert.ok((await p.locator('#approvalsList').textContent()).includes('Урок хоккея event'));
  // Reload preserves the section, using only the URL, without a second request.
  assert.equal(new URL(p.url()).searchParams.get('section'),'approvals');await p.reload();await p.locator('#approvals.active .calculation-card').waitFor();
  for(const id of ['requests','specs','profile','events']){await nav(p,id);await p.reload();await p.locator('#'+id+'.active').waitFor();assert.equal(await section(p),id)}
  await nav(p,'approvals');
  // A delayed pre-decision response must not resurrect a completed approval.
  owner.hold=true;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>owner.held.length===1);
  await p.locator('#approvalsList [data-action=approve_stage]').click();await p.waitForFunction(()=>!document.querySelector('#approvalsList .calculation-card'));
  owner.held.shift()();await p.waitForTimeout(100);assert.equal(await approvalCount(p),0);
  await g.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await g.locator('#approvalsList .calculation-card').waitFor();
  assert.equal(await approvalCount(g),1);await g.locator('#approvalsList [data-action=approve]').click();await g.waitForFunction(()=>!document.querySelector('#approvalsList .calculation-card'));
  assert.equal(db.prepare('SELECT status FROM calculations WHERE id=?').get(first).status,'approved');
  // Passive refresh while remaining in the approvals section.
  const second=await create('own');await send(second);await p.clock.fastForward(30001);await p.locator('#approvalsList .calculation-card').waitFor();
  // Unchanged responses preserve DOM; changed responses preserve expanded history.
  await p.locator('#approvalsList details summary').click();
  await p.locator('#approvalsList .calculation-card').evaluate(n=>n.dataset.sameNode='yes');
  const currentReads=owner.reads;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>owner.reads>currentReads);await p.waitForTimeout(100);
  assert.equal(await p.locator('#approvalsList .calculation-card').getAttribute('data-same-node'),'yes');
  const third=await create('other-event');await send(third);await p.evaluate(()=>window.dispatchEvent(new Event('online')));await waitFor(async()=>await approvalCount(p)===2);
  assert.equal(await p.locator('#approvalsList [data-calculation-id="'+second+'"] details').getAttribute('open'),'');
  // Explicit failure, retry, and no false empty-success screen.
  await nav(p,'home');owner.fail=true;await nav(p,'approvals');assert.equal(await p.locator('#workspaceSync').getAttribute('data-status'),'error');assert.equal(await approvalCount(p),2);
  owner.fail=false;await p.locator('#retryWorkspace').click();await p.waitForFunction(()=>document.querySelector('#workspaceSync').classList.contains('hidden'));assert.equal(await approvalCount(p),2);
  // A read that finishes during a decision cannot replace its disabled button or state.
  owner.hold=true;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>owner.held.length===1);
  owner.pauseWrite=true;const decision=p.locator('#approvalsList [data-calculation-id="'+second+'"] [data-action=approve_stage]');await decision.click();await waitFor(()=>owner.writes.length===1);
  owner.held.shift()();await p.waitForTimeout(100);assert.equal(await decision.isDisabled(),true);
  const writingReads=owner.reads;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(owner.reads,writingReads);
  owner.writes.shift()();await waitFor(async()=>await approvalCount(p)===1);
  // Several foreground triggers coalesce; a late read cannot switch the current section.
  owner.hold=true;await p.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))});await waitFor(()=>owner.held.length===1);
  const heldReads=owner.reads;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(owner.reads,heldReads);
  await nav(p,'profile');await p.locator('#profilePhone').fill('+7 (900) 111-22-33');owner.held.shift()();await p.waitForTimeout(100);
  assert.equal(await section(p),'profile');assert.equal(await p.locator('#profilePhone').inputValue(),'+7 (900) 111-22-33');
  // Navigation and automatic refresh leave an unsaved composition and modal input alone.
  await p.locator('.nav-btn[data-go=add-service]').click();await p.locator('#serviceEvent').selectOption('draft:event');await p.locator('#addCustomPosition').click();
  await p.locator('#cartEditorBody [data-field=name]').fill('Несохранённая позиция');await p.locator('#cartEditorBody [data-field=unitPrice]').fill('2100');
  const editorReads=owner.reads;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.clock.fastForward(30001);
  assert.equal(owner.reads,editorReads);assert.equal(await p.locator('#cartEditorBody [data-field=name]').inputValue(),'Несохранённая позиция');
  await p.locator('#cartEditorDone').click();await nav(p,'requests');assert.equal(await p.locator('#cartCount').textContent(),'1');
  await p.reload();await p.locator('#requests.active').waitFor();
  // A visible read-only dialog also prevents a fetched snapshot from replacing its data.
  await p.locator('#requestsList [data-calculation-id="'+second+'"] .view-request').click();
  const modalReads=owner.reads;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.clock.fastForward(30001);assert.equal(owner.reads,modalReads);await p.locator('#closeRequestDetails').click();
  // Messenger launch data survives section persistence; deep links take initial precedence.
  const launchHash='#tgWebAppData=synthetic-launch-data&tgWebAppPlatform=android';
  await p.goto('https://local.test/?browser=1&section=profile&calculation='+second+launchHash);await p.locator('#requestDetailsModal:not(.hidden)').waitFor();assert.equal(await section(p),'requests');assert.equal(new URL(p.url()).hash,launchHash);
  await p.locator('#closeRequestDetails').click();await nav(p,'approvals');assert.equal(new URL(p.url()).searchParams.get('calculation'),null);assert.equal(new URL(p.url()).hash,launchHash);
  await p.reload();await p.locator('#approvals.active').waitFor();assert.equal(await p.locator('#requestDetailsModal').getAttribute('aria-hidden'),'true');
  await p.goto('https://local.test/?browser=1&section=profile&event=event#WebAppData=synthetic-max');await p.locator('#events.active').waitFor();assert.equal(await p.locator('#eventSearch').inputValue(),'Урок хоккея event');assert.equal(new URL(p.url()).hash,'#WebAppData=synthetic-max');
  await nav(p,'profile');await p.reload();await p.locator('#profile.active').waitFor();assert.equal(new URL(p.url()).searchParams.get('event'),null);
  // Arbitrary and forbidden sections cannot bypass role checks.
  const observer=await client('observer','?browser=1&section=add-service');assert.equal(await section(observer.page),'home');
  await observer.page.goto('https://local.test/?browser=1&section=users');await observer.page.locator('#home.active').waitFor();assert.equal(new URL(observer.page.url()).searchParams.get('section'),'home');
  await observer.page.goto('https://local.test/?browser=1&section=not-a-section');await observer.page.locator('#home.active').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: already-open clients receive employee calculations on navigation/focus/poll, sequential coordinator decisions, reload restores sections, deep links preserve launch hashes, failures/retry, coalesced and stale reads, expanded history, unchanged DOM and unsaved input protection. No external messages sent.');
 }finally{for(const x of clients){for(const resolve of [...x.held,...x.writes])resolve()}await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
