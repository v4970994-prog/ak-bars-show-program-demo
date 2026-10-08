// Browser + real reply handler, SQLite, and local delivery stubs. No production access.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto'),path=require('path'),{chromium}=require('playwright');
const db=new DatabaseSync(':memory:');
const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)||null},async all(){return {results:db.prepare(sql).all(...this.args)}},async run(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
const c=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console,crypto:crypto.webcrypto});c.env=env;c.sent=[];
vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),c);
(async()=>{
 await vm.runInContext('initializeSchema(env)',c);
 db.exec("INSERT INTO seasons(id,code,created_by) VALUES('season','26/27','vil'); INSERT INTO users(telegram_id,first_name,role,status,organization) VALUES('vil','Виль','owner','active','customer'),('gleb','Глеб','coordinator','active','customer'); INSERT INTO events(id,title,place,address,event_date,created_by,season_id) VALUES('event','Урок хоккея','Школа № 1','Адрес школы № 1','2026-10-10T10:30','vil','season'),('event2','Встреча с командой','Школа № 2','Адрес школы № 2','2026-11-12T11:45','vil','season'); INSERT INTO calculations(id,event_id,event_title,created_by,created_by_name,organization,season_id,approval_route,status,total,last_comment,batch_group) VALUES('calc','draft:event','Урок хоккея','vil','Виль','customer','season','vil_to_gleb','returned',10000,'Уточните количество ведущих','batch'),('calc2','draft:event2','Встреча с командой','vil','Виль','customer','season','vil_to_gleb','draft',10000,'','batch'); INSERT INTO calculation_history(calculation_id,actor_id,actor_name,action,from_status,to_status,comment) VALUES('calc','gleb','Глеб','return','approval','returned','Уточните количество ведущих')");
 db.exec("INSERT INTO calculation_items(calculation_id,service_id,name,unit,quantity,unit_price,line_total) VALUES('calc','custom:lead','Ведущий','усл.',1,10000,10000),('calc2','custom:lead','Ведущий','усл.',1,10000,10000)");
 vm.runInContext('requireActive=async()=>testAuth;sendUserMessage=async(env,id,text)=>{sent.push({id,text});return true}',c);
 let html=await(await c.worker.fetch(new Request('https://local.test/'),{})).text();
 const executable=process.env.CHROMIUM_EXECUTABLE;
 const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 const output=process.env.UI_SCREENSHOTS||path.join(__dirname,'../preview');fs.mkdirSync(output,{recursive:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Moscow',locale:'ru-RU'}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 let user={id:'vil',first_name:'Виль',role:'owner',organization:'customer'},dropReplyResponse=true;
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname;
   if(p==='/')return route.fulfill({contentType:'text/html',body:html});
   if(p==='/api/bootstrap'||p==='/api/workspace'){const workspace=await vm.runInContext('loadSharedWorkspace(env)',c);return route.fulfill({json:{ok:true,...workspace,activeSeason:{id:'season',code:'26/27'},user,access:'active',isAdmin:user.role==='owner',isOwner:user.role==='owner',matches:[],services:[],servicesByTeam:{},catalogs:[],standardEstimates:[],contractorPeople:[]}})}
   if(p==='/api/calculations/reply'){
     const body=route.request().postDataJSON();requests.push(body);c.testAuth={body,user,databaseUser:user};const result=await c.worker.fetch(new Request('https://local.test'+p,{method:'POST'}),env);
     if(dropReplyResponse){dropReplyResponse=false;return route.abort('failed')}
     return route.fulfill({status:result.status,contentType:'application/json',body:await result.text()});
   }
   return route.fulfill({contentType:'application/javascript',body:''});
 });
 await page.addInitScript(()=>localStorage.setItem('akbars_web_token','test-only'));
 await page.goto('https://local.test/?browser=1&calculation=calc');await page.locator('#requestDetailsModal:not(.hidden)').waitFor();
 const details=page.locator('#requestDetailsBody');assert.equal(await details.locator('.calculation-events li').count(),2);assert.ok((await details.textContent()).includes('12.11.2026 · 11:45 МСК'));assert.ok((await details.textContent()).includes('Школа № 2'));assert.ok((await details.textContent()).includes('Уточните количество ведущих'));
 await details.locator('.reply-calculation').click();await page.locator('#calculationReplyText').fill('Нужны два ведущих.\n<img src=x onerror=alert(1)>');await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'reply-mobile.png')});
 await page.locator('#calculationReply button[value=reply]').click();await page.waitForFunction(()=>document.getElementById('calculationReplyError').textContent.length>0);assert.equal(await page.locator('#calculationReplyText').inputValue(),'Нужны два ведущих.\n<img src=x onerror=alert(1)>');
 await page.locator('#calculationReply button[value=reply]').click();await page.locator('#calculationReply').waitFor({state:'detached'});await page.waitForFunction(()=>document.getElementById('requestDetailsBody').textContent.includes('Нужны два ведущих.'));
 assert.equal(requests[0].requestKey,requests[1].requestKey,'Retry reuses idempotency key');assert.equal(db.prepare("SELECT count(*) n FROM calculation_history WHERE action='reply'").get().n,1);assert.equal(c.sent.length,1);assert.equal(db.prepare("SELECT status FROM calculations WHERE id='calc'").get().status,'returned');assert.equal(await details.locator('.calculation-comments img').count(),0,'Comment rendered as text');
 await details.locator('.reply-calculation').click();await page.locator('#calculationReplyText').fill('Состав проверен, отправляю повторно');await page.locator('#calculationReply button[value=resubmit]').click();await page.locator('#calculationReply').waitFor({state:'detached'});await page.waitForFunction(()=>document.getElementById('requestDetailsMeta').textContent.includes('На согласовании'));
 assert.equal(db.prepare("SELECT status FROM calculations WHERE id='calc'").get().status,'approval');assert.equal(db.prepare("SELECT status FROM calculations WHERE id='calc2'").get().status,'draft');
 // The reviewer sees the group, dates, places, and replies, with no author-only button.
 user={id:'gleb',first_name:'Глеб',role:'coordinator',organization:'customer'};await page.reload();await page.locator('#requestDetailsModal:not(.hidden)').waitFor();assert.equal(await details.locator('.reply-calculation').count(),0);assert.equal(await details.locator('.calculation-events li').count(),2);await details.locator('.calculation-comments summary').click();assert.ok((await details.textContent()).includes('Состав проверен, отправляю повторно'));
 await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'group-approval-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('#closeRequestDetails').click();await page.locator('.nav-btn[data-go=approvals]').click();assert.equal(await page.locator('#approvalsList .calculation-card').count(),1);assert.equal(await page.locator('#approvalsList .calculation-events li').count(),2);assert.ok((await page.locator('#approvalsList .money').textContent()).includes('10'));assert.ok((await page.locator('#approvalsList .calculation-events li').first().textContent()).includes('10'));assert.ok((await page.locator('#approvalsList').textContent()).includes('Школа № 2'));
 await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(250);await page.screenshot({path:path.join(output,'group-approval-desktop.png')});assert.deepEqual(errors,[]);
 console.log('PASS: browser/SQLite reply flow, network-loss retry, escaped comments, resubmission, reviewer permissions, group context in approvals and details, direct links, mobile layout.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
