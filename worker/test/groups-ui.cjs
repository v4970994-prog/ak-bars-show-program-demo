// Real browser + SQLite: one visible card and one decision for nine events.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto'),path=require('path'),{chromium}=require('playwright');
const db=new DatabaseSync(':memory:');
const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)||null},async all(){return {results:db.prepare(sql).all(...this.args)}},async run(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
const c=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console,crypto:crypto.webcrypto});c.env=env;c.sent=[];
vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),c);
(async()=>{
 await vm.runInContext('initializeSchema(env)',c);
 db.exec("INSERT INTO seasons(id,code,created_by) VALUES('season','26/27','vil'); INSERT INTO users(telegram_id,first_name,role,status,organization) VALUES('vil','Виль','owner','active','customer'),('gleb','Глеб','coordinator','active','customer'),('manager','Менеджер','contractor_manager','active','contractor')");
 for(let i=1;i<=9;i++){
  db.prepare("INSERT INTO events(id,title,place,address,event_date,created_by,season_id) VALUES(?,'Урок хоккея',?,?,?,'vil','season')").run('event'+i,'Школа № '+i,'Адрес школы № '+i,'2026-'+(i<=4?'10':'11')+'-'+String(10+i)+'T10:30');
  db.prepare("INSERT INTO calculations(id,event_id,event_title,created_by,created_by_name,organization,season_id,approval_route,status,total,batch_group) VALUES(?,?,'Урок хоккея','vil','Виль','customer','season','vil_to_gleb','draft',39474,'legacy')").run('calc'+i,'draft:event'+i);
  db.prepare("INSERT INTO calculation_items(calculation_id,service_id,name,unit,quantity,unit_price,line_total) VALUES(?,'custom:lead','Ведущий','усл.',1,39474,39474)").run('calc'+i);
 }
 vm.runInContext('requireActive=async()=>auth;sendUserMessage=async(env,id,text)=>{sent.push({id,text});return true}',c);
 const html=await(await c.worker.fetch(new Request('https://local.test/'),{})).text(),executable=process.env.CHROMIUM_EXECUTABLE;
 const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 const output=process.env.UI_SCREENSHOTS||path.join(__dirname,'../preview');fs.mkdirSync(output,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Moscow',locale:'ru-RU',acceptDownloads:true}),page=await context.newPage(),errors=[],actions=[];
  let user={id:'vil',first_name:'Виль',role:'owner',organization:'customer'};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),p=url.pathname;
    if(p==='/')return route.fulfill({contentType:'text/html',body:html});
    if(p.includes('exceljs'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'../../vendor/exceljs.min.js'))});
    if(p==='/api/bootstrap'||p==='/api/workspace'){const workspace=await vm.runInContext('loadSharedWorkspace(env)',c);return route.fulfill({json:{ok:true,...workspace,activeSeason:{id:'season',code:'26/27'},user,access:'active',isAdmin:user.role==='owner',isOwner:user.role==='owner',matches:[],services:[],servicesByTeam:{},catalogs:[],standardEstimates:[],contractorPeople:[]}})}
    if(p.startsWith('/api/calculations/')){
      const body=request.postDataJSON();actions.push({path:p,body});c.auth={body,user,databaseUser:user};
      const response=await c.worker.fetch(new Request('https://local.test'+p,{method:'POST'}),env);
      return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    }
    return route.fulfill({contentType:'application/javascript',body:''});
  });
  await page.addInitScript(()=>localStorage.setItem('akbars_web_token','local-test-token'));
  await page.goto('https://local.test/?browser=1');await page.locator('.nav-btn[data-go=requests]').click();
  const list=page.locator('#requestsList');
  assert.equal(await list.locator('.calculation-card').count(),1);
  assert.equal(await list.locator('.calculation-event-list:visible').count(),0);
  assert.ok((await list.locator('.money').textContent()).replace(/\s/g,'').includes('355266'));
  assert.ok((await list.textContent()).includes('39 474'));
  assert.equal(await page.locator('#draftsCount').textContent(),'1');
  await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'common-calculation-desktop.png')});
  await list.getByRole('button',{name:'Посмотреть мероприятия (9)',exact:true}).click();
  assert.equal(await list.locator('.calculation-event-list li:visible').count(),9);
  assert.ok((await list.textContent()).includes('Школа № 9'));
  await list.getByRole('button',{name:'Скрыть мероприятия (9)',exact:true}).click();
  await list.getByRole('button',{name:'Посмотреть состав',exact:true}).click();
  assert.equal(await page.locator('#requestDetailsBody .request-item').count(),1,'Identical composition shown once');
  assert.ok((await page.locator('#requestDetailsTotal').textContent()).replace(/\s/g,'').includes('355266'));
  await page.locator('#closeRequestDetails').click();
  await list.getByRole('button',{name:'Отправить на согласование',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#requestsList .pill').textContent==='На согласовании');
  assert.equal(actions.filter(x=>x.body.action==='send_approval').length,1);
  assert.equal(db.prepare("SELECT count(*) n FROM calculations WHERE status='approval'").get().n,9);
  assert.deepEqual(Array.from(c.sent,x=>x.id),['gleb']);
  // The next coordinator sees one card, and a single click approves all nine.
  user={id:'gleb',first_name:'Глеб',role:'coordinator',organization:'customer'};
  await page.reload();await page.locator('.nav-btn[data-go=approvals]').click();
  const approvals=page.locator('#approvalsList');assert.equal(await approvals.locator('.calculation-card').count(),1);
  assert.equal(await approvals.locator('.calculation-event-list:visible').count(),0);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);
  await page.screenshot({path:path.join(output,'common-approval-mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await approvals.getByRole('button',{name:'Посмотреть мероприятия (9)',exact:true}).click();
  assert.equal(await approvals.locator('.calculation-event-list li:visible').count(),9);
  await approvals.getByRole('button',{name:'Согласовать',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#approvalsList .calculation-card'));
  assert.equal(actions.filter(x=>x.body.action==='approve').length,1);
  assert.equal(db.prepare("SELECT count(*) n FROM calculations WHERE status='approved'").get().n,9);
  assert.deepEqual(Array.from(c.sent.slice(1),x=>x.id).sort(),['manager','vil']);
  // The monthly specification keeps only its four October events and their prices.
  await page.locator('.nav-btn[data-go=specs]').click();await page.locator('#specMonth').selectOption('2026-10');
  assert.equal(await page.locator('#specSummary > .calculation-card').count(),4);
  assert.ok(!(await page.locator('#specSummary > .calculation-card').allTextContents()).join(' ').includes('Школа № 9'));
  // Group Excel contains a summary and one sheet for each event; per-event totals stay intact.
  await page.locator('.nav-btn[data-go=requests]').click();
  const downloadPromise=page.waitForEvent('download');
  await list.getByRole('button',{name:'Скачать Excel',exact:true}).click();
  const download=await downloadPromise,downloadPath=await download.path();
  const ExcelJS=require('../../vendor/exceljs.min.js'),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(fs.readFileSync(downloadPath));
  assert.equal(workbook.worksheets.length,10);assert.equal(workbook.worksheets[0].getCell('D11').value,355266);
  assert.ok(workbook.worksheets[9].getCell('A1').value.includes('Школа № 9'));
  // Existing group remains one card under an event category filter.
  await page.locator('#requestsEventTypeFilter').selectOption('other');assert.equal(await list.locator('.calculation-card').count(),1);
  await page.locator('#requestsEventTypeFilter').selectOption('ak-bars');assert.equal(await list.locator('.calculation-card').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: one card for nine legacy events, collapsed event list, single composition, one submit/approval API call, one notification per recipient, mobile layout, monthly accounting and complete group Excel.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
