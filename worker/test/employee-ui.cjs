const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright'),fixture=require('./employee-fixture.cjs');
(async()=>{
 const {db,c,env,response}=await fixture();
 let html=await(await c.worker.fetch(new Request('https://local.test/'),env)).text();
 html=html.replace('    init();','    window.employeeUI={refreshWorkspace};init();');
 const executable=process.env.CHROMIUM_EXECUTABLE,browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 const output=process.env.UI_SCREENSHOTS||path.join(__dirname,'../preview');fs.mkdirSync(output,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Moscow',locale:'ru-RU'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   if(p==='/')return route.fulfill({contentType:'text/html',body:html});
   if(p.startsWith('/api/')){const body=request.postDataJSON(),r=await response(p,body);return route.fulfill({status:r.status,contentType:'application/json',body:await r.text()})}
   return route.fulfill({contentType:'application/javascript',body:''});
  });
  await page.clock.setFixedTime(new Date('2026-10-26T09:00:00Z'));
  await page.addInitScript(()=>localStorage.setItem('akbars_web_token','local-token-employee'));
  await page.goto('https://local.test/?browser=1');await page.locator('#shell:not(.hidden)').waitFor();
  assert.equal(await page.locator('#userRole').textContent(),'Сотрудник СКП');
  assert.equal(await page.locator('#home .calculation-create-control').isVisible(),true);
  assert.ok((await page.locator('#home .calculation-create-control').textContent()).includes('Создать расчёт'));
  assert.equal(await page.locator('.nav-btn[aria-label="Создать расчёт"]').isVisible(),true);
  await page.locator('.nav-btn[data-go=requests]').click();
  await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'employee-calculations-mobile.png')});
  await page.locator('#requests [data-go=add-service]').click();
  await page.locator('#serviceEvent').selectOption('draft:event');
  await page.locator('#addCustomPosition').click();
  await page.locator('#cartEditorBody [data-field=name]').fill('Ведущий');
  await page.locator('#cartEditorBody [data-field=unitPrice]').fill('1000');
  await page.locator('#cartEditorDone').click();await page.locator('#saveRequest').click();
  await page.locator('#requests.active .calculation-card').waitFor();
  assert.equal(db.prepare('SELECT created_by FROM calculations').get().created_by,'employee');
  await page.locator('#requestsList [data-action=send_approval]').click();
  await page.waitForFunction(()=>document.querySelector('#requestsList .pill').textContent==='Проверка координатором');
  assert.equal(db.prepare('SELECT current_approver_role FROM calculations').get().current_approver_role,'owner');
  assert.deepEqual(Array.from(c.sent,x=>x.id),['vil']);
  // Employee can appoint a contractor to a coordinator-imported event and a match.
  await page.locator('.nav-btn[data-go=home]').click();await page.locator('#home [data-go=events]').click();
  assert.equal(await page.locator('.edit-stored-event[data-id=event]').count(),0);
  assert.equal(await page.locator('.delete-stored-event[data-id=event]').count(),0);
  assert.equal(await page.locator('.assign-event[data-id=match]').isVisible(),true);
  await page.locator('.assign-event[data-id=event]').click();
  await page.locator('.responsible-option').filter({has:page.locator('input[value=artist]')}).click();
  await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'employee-responsible-mobile.png')});
  await page.locator('#responsibleEditor button[type=submit]').click();
  await page.locator('#responsibleEditor').waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('#eventManagementStatus').textContent.includes('назначен'));
  assert.equal(db.prepare("SELECT responsible_user_id FROM events WHERE id='event'").get().responsible_user_id,'artist');
  assert.equal(c.sent.at(-1).id,'artist');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // Workspace refresh applies newly assigned/revoked roles without another browser login.
  db.prepare("UPDATE users SET role='executive' WHERE telegram_id='employee'").run();
  await page.evaluate(()=>window.employeeUI.refreshWorkspace());
  assert.equal(await page.locator('.assign-event').count(),0);
  assert.equal(await page.locator('.nav-btn[data-go=add-service]').isVisible(),false);
  await page.locator('.nav-btn[data-go=requests]').click();assert.equal(await page.locator('#requests .calculation-create-control').isVisible(),false);
  db.prepare("UPDATE users SET role='employee' WHERE telegram_id='employee'").run();
  await page.evaluate(()=>window.employeeUI.refreshWorkspace());
  assert.equal(await page.locator('#requests .calculation-create-control').isVisible(),true);
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.locator('.nav-btn[aria-label="Создать расчёт"]').isVisible(),true);
  await page.locator('#requests [data-go=add-service]').click();assert.equal(await page.locator('#add-service.active').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS: SKP employee mobile/desktop navigation, real authenticated save/send to Vil, assignment for imported events and matches, and live role refresh. No real notifications sent.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
