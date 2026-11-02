const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright'),ExcelJS=require('../../vendor/exceljs.min.js'),fixture=require('./events-export-fixture.cjs');
(async()=>{
 const {db,c,env,response}=await fixture(),html=await(await c.worker.fetch(new Request('https://local.test/'),env)).text();
 const executable=process.env.CHROMIUM_EXECUTABLE,browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 const errors=[],output=process.env.UI_SCREENSHOTS||path.join(__dirname,'../preview');fs.mkdirSync(output,{recursive:true});
 let exportFailure=false,holdExport=false;const exportReleases=[];
 async function client(id){
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles',locale:'ru-RU'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-31T22:30:00Z'));
  await page.addInitScript(token=>localStorage.setItem('akbars_web_token',token),'local-token-'+id);
  await page.route('**/*',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   if(p==='/')return route.fulfill({contentType:'text/html',body:html});
   if(p==='/vendor/exceljs.min.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'../../vendor/exceljs.min.js'))});
   if(p.startsWith('/api/')){
    if(p==='/api/events/export'&&holdExport)await new Promise(resolve=>exportReleases.push(resolve));
    if(p==='/api/events/export'&&exportFailure)return route.fulfill({status:503,json:{ok:false,error:'Не удалось получить события для выгрузки'}});
    const r=await response(p,req.postDataJSON());return route.fulfill({status:r.status,contentType:'application/json',body:await r.text()});
   }
   return route.fulfill({contentType:'application/javascript',body:''});
  });
  await page.goto('https://local.test/?browser=1&section=events');await page.locator('#events.active').waitFor();return page;
 }
 async function download(page){
  const pending=page.waitForEvent('download');await page.locator('#eventExportForm button[type=submit]').click();
  const result=await pending,workbook=new ExcelJS.Workbook();await workbook.xlsx.load(fs.readFileSync(await result.path()));return {workbook,fileName:result.suggestedFilename()};
 }
 try{
  const page=await client('gleb');
  assert.equal(await page.locator('#openEventExport').isVisible(),true,'coordinator has the calendar export button');
  // A search that hides everything and the default hide-past setting must not affect the file.
  await page.locator('#eventSearch').fill('Ничего не найдено');
  await page.locator('#openEventExport').click();
  assert.equal(await page.locator('#eventExportFrom').inputValue(),'2026-11-01','default month uses Moscow, not device timezone');
  assert.equal(await page.locator('#eventExportTo').inputValue(),'2026-11-30');
  assert.match(await page.locator('#eventExportScope').textContent(),/26\/27/);
  await page.locator('#eventExportFrom').fill('2026-10-01');await page.locator('#eventExportTo').fill('2026-10-31');
  await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'events-export-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'events-export-mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000});
  // Disabling submit during a slow export must not let keyboard focus escape the dialog.
  holdExport=true;await page.locator('#eventExportForm button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#eventExportForm').getAttribute('aria-busy')==='true');
  await page.keyboard.press('Tab');assert.equal(await page.locator('#eventExportDialog').evaluate(n=>n.contains(document.activeElement)),true,'busy dialog retains keyboard focus');
  await page.keyboard.press('Escape');await page.locator('#eventExportDialog').waitFor({state:'detached'});
  holdExport=false;exportReleases.splice(0).forEach(resolve=>resolve());
  await page.locator('#openEventExport').click();
  const {workbook,fileName}=await download(page),sheet=workbook.getWorksheet('Мероприятия');
  assert.match(fileName,/2026-10-01_2026-10-31/);
  assert.equal(sheet.getCell('A1').value,'Календарь мероприятий');assert.match(sheet.getCell('A2').value,/26\/27/);
  assert.match(sheet.getCell('A3').value,/01\.10\.2026.*31\.10\.2026/);assert.match(sheet.getCell('A4').value,/Все события/);
  assert.equal(sheet.rowCount,12,'six data rows plus six title/header rows');
  assert.deepEqual(sheet.getRow(6).values.slice(1),['№','Дата','Время (МСК)','Тип','Команда','Мероприятие','Площадка','Адрес','Контакт площадки','Телефон','Ответственный подрядчика','Комментарий']);
  assert.equal(sheet.getCell('B7').value.toISOString(),'2026-10-01T00:00:00.000Z');
  assert.equal(sheet.getCell('C7').value.toISOString(),'1899-12-30T00:00:00.000Z');assert.equal(sheet.getCell('C7').numFmt,'hh:mm');
  assert.equal(sheet.getCell('B12').value.toISOString(),'2026-10-31T00:00:00.000Z');
  assert.equal(sheet.getCell('C12').value.toISOString(),'1899-12-30T23:59:00.000Z');
  assert.equal(sheet.getCell('J8').value,'+79000000000');assert.equal(sheet.getCell('F8').value,'=2+2');assert.equal(sheet.getCell('F8').formula,undefined);
  assert.equal(sheet.getCell('K8').value,'Менеджер Подрядчика');assert.equal(sheet.getCell('L8').value,'<b>Текст</b> & "кавычки"\nВторая строка');
  assert.equal(sheet.getCell('E8').value,'');assert.equal(sheet.getCell('E11').value,'Ак Барс');
  assert.equal(sheet.views[0].ySplit,6);assert.ok(sheet.autoFilter);
  // Freshly moved event is excluded without reloading the calendar.
  db.exec("UPDATE events SET event_date='2026-11-02T12:00' WHERE id='end'");
  await page.locator('#eventExportType').selectOption('other');
  const others=await download(page);assert.equal(others.workbook.getWorksheet('Мероприятия').rowCount,7);
  await page.locator('#eventExportType').selectOption('matches');await page.locator('#eventExportTeam').selectOption('irbis');
  const matches=await download(page),matchSheet=matches.workbook.getWorksheet('Мероприятия');
  assert.equal(matchSheet.rowCount,7);assert.equal(matchSheet.getCell('E7').value,'Ирбис');assert.match(matchSheet.getCell('A4').value,/Ирбис/);
  await page.locator('#eventExportType').selectOption('other');assert.equal(await page.locator('#eventExportTeam').inputValue(),'all');assert.equal(await page.locator('#eventExportTeam').isDisabled(),true);
  await page.locator('#eventExportFrom').fill('2026-10-02');await page.locator('#eventExportTo').fill('2026-10-03');
  let downloads=0;page.on('download',()=>downloads++);
  await page.locator('#eventExportForm button[type=submit]').click();await page.getByText('За выбранный период событий нет. Измените даты или фильтр.',{exact:true}).waitFor();assert.equal(downloads,0);
  await page.locator('#eventExportFrom').fill('2026-10-04');await page.locator('#eventExportForm button[type=submit]').click();await page.getByText('Дата начала не может быть позже даты окончания',{exact:true}).waitFor();
  await page.locator('#eventExportFrom').fill('2026-10-01');await page.locator('#eventExportTo').fill('2026-10-31');exportFailure=true;
  await page.locator('#eventExportForm button[type=submit]').click();await page.getByText('Не удалось получить события для выгрузки',{exact:true}).waitFor();assert.equal(await page.locator('#eventExportForm button[type=submit]').isEnabled(),true);exportFailure=false;
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // Keyboard stays within the modal and Escape restores the entry button.
  await page.locator('#eventExportDialog .modal-close').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#eventExportForm button[type=submit]').evaluate(n=>n===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('#eventExportDialog .modal-close').evaluate(n=>n===document.activeElement),true);
  await page.keyboard.press('Escape');await page.locator('#eventExportDialog').waitFor({state:'detached'});
  assert.equal(await page.locator('#openEventExport').evaluate(n=>n===document.activeElement),true);
  await page.locator('#openEventExport').click();assert.equal(await page.locator('#eventExportFrom').inputValue(),'2026-10-01');
  db.exec("UPDATE users SET role='employee' WHERE telegram_id='gleb'");
  await page.locator('#eventExportForm button[type=submit]').click();await page.getByText('Выгрузка доступна координаторам СКП',{exact:true}).waitFor();assert.equal(downloads,0,'revocation prevents download from an already-open dialog');
  for(const id of ['employee','observer','manager','artist']){const restricted=await client(id);assert.equal(await restricted.locator('#openEventExport').isVisible(),false,id);await restricted.close()}
  const owner=await client('vil');assert.equal(await owner.locator('#openEventExport').isVisible(),true);await owner.close();
  assert.deepEqual(errors,[]);assert.equal(c.sent.length,0);
  console.log('PASS: coordinator calendar export, real XLSX data/types/formula safety, Moscow defaults, fresh filters, empty/error/revoked states, keyboard and mobile layout. No real notifications sent.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
