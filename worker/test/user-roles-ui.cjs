// Regression: an unknown stored role must never look like the first valid role.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright'),fixture=require('./employee-fixture.cjs');
(async()=>{
 const {db,c,env,response,call}=await fixture();
 db.prepare("UPDATE users SET role='legacy-role' WHERE telegram_id='employee'").run();
 db.prepare("UPDATE users SET organization='legacy-company',role='legacy-role' WHERE telegram_id='other'").run();
 const html=await(await c.worker.fetch(new Request('https://local.test/'),env)).text(),errors=[],updates=[];
 const executable=process.env.CHROMIUM_EXECUTABLE,browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 async function openAs(id){
  const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'Europe/Moscow',locale:'ru-RU'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-26T09:00:00Z'));
  await page.route('**/*',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   if(p==='/')return route.fulfill({contentType:'text/html',body:html});
   if(p.startsWith('/api/')){const body=request.postDataJSON();if(p==='/api/users/update')updates.push(body);const r=await response(p,body);return route.fulfill({status:r.status,contentType:'application/json',body:await r.text()})}
   return route.fulfill({contentType:'application/javascript',body:''});
  });
  await page.addInitScript(token=>localStorage.setItem('akbars_web_token',token),'local-token-'+id);
  await page.goto('https://local.test/?browser=1');await page.locator('#shell:not(.hidden)').waitFor();return page;
 }
 try{
  const employee=await openAs('employee');
  assert.equal(await employee.locator('#home .calculation-create-control').isVisible(),false);
  await employee.locator('#home [data-go=events]').click();await employee.locator('#eventSearch').fill('Урок хоккея event');
  assert.equal(await employee.locator('.assign-event').count(),0);
  assert.equal((await call('/api/events/assign',{id:'event',expectedRevision:1,responsibleId:'artist'})).httpStatus,403);
  const admin=await openAs('vil');await admin.locator('#usersAction').click();
  const card=admin.locator('.user-card[data-user-id=employee]');await card.waitFor();
  assert.equal(await card.locator('.pill').textContent(),'Роль не настроена');
  assert.equal(await card.locator('.user-organization').inputValue(),'customer');
  assert.equal(await card.locator('.user-role').inputValue(),'');
  assert.equal(await card.locator('.user-role option:checked').textContent(),'Выберите роль');
  assert.equal(await card.locator('.user-role-notice').isVisible(),true);
  const oldOrg=admin.locator('.user-card[data-user-id=other]');assert.equal(await oldOrg.locator('.user-organization').inputValue(),'');assert.equal(await oldOrg.locator('.user-role').inputValue(),'');
  assert.equal(await admin.locator('.user-card[data-user-id=observer] .user-role').inputValue(),'executive');
  assert.equal(await admin.locator('.user-card[data-user-id=manager] .user-role').inputValue(),'contractor_manager');
  await card.locator('[data-action=save]').click();assert.equal(updates.length,0);assert.equal(db.prepare("SELECT role FROM users WHERE telegram_id='employee'").get().role,'legacy-role');
  // Changing the organization also requires an explicit valid role selection.
  await card.locator('.user-organization').selectOption('contractor');assert.equal(await card.locator('.user-role').inputValue(),'');
  assert.deepEqual(await card.locator('.user-role option:not([disabled])').evaluateAll(nodes=>nodes.map(n=>n.value)),['contractor_manager','performer']);
  await card.locator('.user-organization').selectOption('customer');assert.equal(await card.locator('.user-role').inputValue(),'');
  await card.locator('.user-role').selectOption('employee');
  assert.equal(db.prepare("SELECT role FROM users WHERE telegram_id='employee'").get().role,'legacy-role','Selection alone does not grant rights');
  const output=process.env.UI_SCREENSHOTS||path.join(__dirname,'../preview');fs.mkdirSync(output,{recursive:true});
  await card.scrollIntoViewIfNeeded();await admin.waitForTimeout(300);await card.screenshot({path:path.join(output,'explicit-role-before-save.png')});
  await card.locator('[data-action=save]').click();
  await admin.waitForFunction(()=>document.querySelector('.user-card[data-user-id=employee] .pill').textContent==='Сотрудник СКП');
  assert.equal(await card.locator('.user-role-notice').count(),0);assert.equal(updates.length,1);assert.equal(updates[0].role,'employee');assert.equal(updates[0].status,undefined);assert.equal(c.sent.length,0,'Saving a role does not send an unsolicited message');
  assert.equal(db.prepare("SELECT role FROM users WHERE telegram_id='employee'").get().role,'employee');
  await employee.reload();await employee.locator('#shell:not(.hidden)').waitFor();
  assert.equal(await employee.locator('#home .calculation-create-control').isVisible(),true);
  await employee.locator('#home [data-go=events]').click();await employee.locator('#eventSearch').fill('Урок хоккея event');
  assert.equal(await employee.locator('.assign-event[data-id=event]').isVisible(),true);
  const max=await openAs('max:123');assert.equal(await max.locator('#userRole').textContent(),'Сотрудник СКП');assert.equal(await max.locator('#home .calculation-create-control').isVisible(),true);
  const result=await call('/api/calculations/save',{eventId:'draft:event',eventTitle:'Урок хоккея event',items:[{id:'custom:role-test',custom:true,name:'Ведущий',unit:'усл.',qty:1,unitPrice:1000}]},'max:123');assert.equal(result.httpStatus,200,JSON.stringify(result));
  assert.equal((await call('/api/events/assign',{id:'event',expectedRevision:1,responsibleId:'artist'},'max:123')).httpStatus,200);
  assert.deepEqual(errors,[]);
  console.log('PASS: unsupported saved role reproduced, no silent employee/organization fallback, explicit admin save, refreshed canonical and linked MAX access to calculation creation and assignment. No real messages sent.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
