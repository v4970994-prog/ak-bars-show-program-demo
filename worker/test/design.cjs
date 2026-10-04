// Local browser checks with fake APIs and users. Does not access a production server.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{chromium}=require('playwright'),path=require('path');
const c=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console});
vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),c);
(async()=>{
 let html=await(await c.worker.fetch(new Request('https://local.test/'),{})).text();html=html.replace('    init();','    window.testUI={state,go,renderMatches};init();');
 const executable=process.env.CHROMIUM_EXECUTABLE;
 const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 const output=process.env.UI_SCREENSHOTS||path.join(__dirname,'../preview');fs.mkdirSync(output,{recursive:true});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Moscow',locale:'ru-RU'});const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 let events=[{id:'match',type:'match',team:'ak-bars',title:'Ак Барс - Соперник',place:'Татнефть Арена',address:'Казань',date:'2026-10-10T19:00',createdBy:'vil',revision:1},{id:'event',type:'event',title:'Урок хоккея',place:'Школа № 1',address:'Казань, тестовый адрес',date:'2026-10-10T10:00',contact:'Контакт площадки',phone:'+70000000000',createdBy:'vil',revision:1},{id:'nov',type:'match',team:'bars',title:'Барс - Соперник',place:'Дворец спорта',date:'2026-11-02T18:30',createdBy:'vil',revision:1}];
 const people=[{id:'manager',name:'Менеджер подрядчика',role:'contractor_manager'},{id:'artist',name:'Ответственный исполнитель',role:'performer'}];
 const services=[{id:'s1',position:'1',name:'Ведущий',category:'Чаша',unit:'усл.',price:10000,defaultQty:1,description:'Проведение программы'}];
 const calculations=[{id:'calc',event:'draft:event',eventTitle:'Урок хоккея',createdBy:'vil',createdByName:'Виль',status:'approved',total:10000,version:1,items:[{...services[0],qty:1,total:10000}],history:[]}];
 const base={ok:true,activeSeason:{id:'season',code:'26/27'},services,servicesByTeam:{'ak-bars':services},calculations,catalogs:[],standardEstimates:[],contractorPeople:people};
 await page.route('**/*',async route=>{const url=new URL(route.request().url()),p=url.pathname;let payload={};try{payload=route.request().postDataJSON()||{}}catch{}
  if(p==='/')return route.fulfill({contentType:'text/html',body:html});
  if(p==='/api/bootstrap')return route.fulfill({json:{...base,user:{id:'vil',role:'owner',organization:'customer',first_name:'Виль'},access:'active',isAdmin:true,isOwner:true,matches:[]}});
  if(p==='/api/workspace')return route.fulfill({json:{...base,events}});
  if(p==='/api/events/assign'){writes.push(payload);events=events.map(e=>e.id===payload.id?{...e,responsibleId:payload.responsibleId,responsibleName:people.find(p=>p.id===payload.responsibleId)?.name||'',revision:e.revision+1}:e);return route.fulfill({json:{ok:true,notificationSent:true}})}
  if(p.startsWith('/api/'))return route.fulfill({json:{ok:true,users:[]}});
  return route.fulfill({contentType:'application/javascript',body:''});
 });
 await page.addInitScript(()=>localStorage.setItem('akbars_web_token','test-only'));
 await page.goto('https://local.test/?browser=1');await page.locator('#shell:not(.hidden)').waitFor();await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('TTOcto')),false);
 await page.waitForTimeout(260);await page.screenshot({path:path.join(output,'desktop-light.png')});
 await page.locator('#themeToggle').click();await page.waitForTimeout(260);await page.screenshot({path:path.join(output,'desktop-dark.png')});await page.reload();await page.locator('#shell:not(.hidden)').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');await page.locator('#themeToggle').click();
 // Click the corner of the whole navigation card, not its title.
 await page.locator('.action[data-go="events"]').click({position:{x:10,y:10}});assert.equal(await page.locator('#events').getAttribute('class'),'section active');
 assert.equal(await page.locator('.calendar-weekday').count(),7);await page.locator('[data-calendar-day="2026-10-10"]').first().click();assert.equal(await page.locator('.match').count(),2);
 await page.waitForTimeout(260);await page.screenshot({path:path.join(output,'calendar-desktop.png')});
 await page.locator('.assign-event[data-id="event"]').click();await page.locator('#responsibleSelect').selectOption('artist');await page.waitForTimeout(260);await page.screenshot({path:path.join(output,'responsible-desktop.png')});await page.locator('#responsibleEditor button[type=submit]').click();await page.locator('#responsibleEditor').waitFor({state:'detached'});assert.equal(writes[0].expectedRevision,1);assert.equal(writes[0].responsibleId,'artist');await page.waitForFunction(()=>document.getElementById('eventManagementStatus').textContent.includes('назначен'));
 await page.locator('.event-calculations[data-id="event"]').click();assert.equal(await page.locator('#requests .calculation-card').count(),1);await page.locator('#requests .view-request').click();assert.ok((await page.locator('#requestDetailsBody').textContent()).includes('Ведущий'));await page.locator('#closeRequestDetails').click();
 await page.evaluate(()=>window.testUI.go('home'));
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await page.waitForTimeout(260);await page.screenshot({path:path.join(output,'mobile-light.png')});
 for(const section of ['home','events','requests','profile','new-event','add-service','specs']){await page.evaluate(id=>window.testUI.go(id),section);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No overflow: '+section)}
 await page.evaluate(()=>window.testUI.go('events'));assert.equal(await page.locator('.event-calendar').count(),0);assert.equal(await page.locator('.match').count(),3);
 await page.locator('.assign-event[data-id="event"]').click();await page.waitForTimeout(260);await page.screenshot({path:path.join(output,'responsible-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#responsibleEditor .modal-close').click();
 await page.evaluate(()=>window.testUI.go('home'));await page.locator('#themeToggle').click();await page.waitForTimeout(260);await page.screenshot({path:path.join(output,'mobile-dark.png')});
 await page.setViewportSize({width:320,height:700});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No 320px overflow');
 // Deep link from notifications opens matching event, including its month.
 await page.setViewportSize({width:1440,height:1000});await page.goto('https://local.test/?event=nov');await page.locator('#events.active').waitFor();assert.ok((await page.locator('.event-calendar-toolbar').textContent()).includes('ноябрь'));
 assert.deepEqual(errors,[]);console.log('PASS: real Chromium, light/dark persistence, whole-card navigation, desktop month calendar, mobile chronological list, assignment form/revision, event-specific calculation details, deep links, 320/390px overflow checks.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
