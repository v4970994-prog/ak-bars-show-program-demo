// Returned-calculation replies against real SQLite. Delivery stays local and mocked.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
const db=new DatabaseSync(':memory:');let beforeBatch=null;
const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)||null},async all(){return {results:db.prepare(sql).all(...this.args)}},async run(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}}},async batch(statements){if(beforeBatch){const run=beforeBatch;beforeBatch=null;run()}db.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
const ctx=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console,crypto:crypto.webcrypto});
vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),ctx);ctx.env=env;ctx.sent=[];
async function call(body,id='vil',role='owner',org='customer',endpoint='reply'){
 ctx.testAuth={body,user:{id,first_name:id},databaseUser:{role,organization:org}};
 const r=await ctx.worker.fetch(new Request('https://example.test/api/calculations/'+endpoint,{method:'POST'}),env);return {status:r.status,...await r.json(),httpStatus:r.status};
}
let n=0;
function payload(extra={}){return {id:'calc',comment:'Уточнил количество\nи время',resubmit:false,expectedVersion:1,returnId:1,requestKey:'local-request-key-'+(++n),...extra}}
const calc=()=>db.prepare("SELECT * FROM calculations WHERE id='calc'").get();
const count=()=>db.prepare("SELECT count(*) n FROM calculation_history WHERE action='reply'").get().n;
(async()=>{
 // Upgrade a pre-reply history table without losing existing comments.
 db.exec("CREATE TABLE calculation_history(id INTEGER PRIMARY KEY AUTOINCREMENT,calculation_id TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL DEFAULT '',action TEXT NOT NULL,from_status TEXT NOT NULL DEFAULT '',to_status TEXT NOT NULL DEFAULT '',comment TEXT NOT NULL DEFAULT '',snapshot TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO calculation_history(calculation_id,actor_id,actor_name,action,from_status,to_status,comment) VALUES('calc','gleb','Глеб','return','approval','returned','Уточните количество')");
 await vm.runInContext('initializeSchema(env)',ctx);await vm.runInContext('initializeSchema(env)',ctx);
 assert.equal(db.prepare('SELECT comment FROM calculation_history WHERE id=1').get().comment,'Уточните количество');
 db.exec("INSERT INTO seasons(id,code,created_by) VALUES('season','26/27','vil'); INSERT INTO events(id,title,place,event_date,created_by,season_id) VALUES('event','Урок хоккея','Школа № 1','2026-11-02T10:30','vil','season'),('event2','Встреча команды','Школа № 2','2026-12-02T11:30','vil','season'); INSERT INTO calculations(id,event_id,event_title,created_by,created_by_name,organization,season_id,approval_route,status,total,last_comment,batch_group) VALUES('calc','draft:event','Урок хоккея','vil','Виль','customer','season','vil_to_gleb','returned',10000,'Уточните количество','batch'),('calc2','draft:event2','Встреча команды','vil','Виль','customer','season','vil_to_gleb','draft',10000,'','batch')");
 for(const [id,role] of [['vil','owner'],['gleb','coordinator'],['employee','employee'],['manager','contractor_manager'],['stas','executive']])db.prepare('INSERT INTO users(telegram_id,role,status,organization) VALUES(?,?,?,?)').run(id,role,'active',id==='manager'?'contractor':'customer');
 vm.runInContext('requireActive=async()=>testAuth;sendUserMessage=async(env,id,text)=>{sent.push({id,text});return true}',ctx);
 for(const [id,role,org] of [['someone','employee','customer'],['gleb','coordinator','customer'],['vil','performer','contractor'],['vil','executive','customer']])assert.equal((await call(payload(),id,role,org)).httpStatus,403);
 for(const extra of [{comment:''},{comment:' '.repeat(10)},{comment:'x'.repeat(1501)},{resubmit:'yes'},{requestKey:'short'},{returnId:0}])assert.equal((await call(payload(extra))).httpStatus,400);
 assert.equal((await call(payload({returnId:2}))).httpStatus,409);assert.equal((await call(payload({expectedVersion:2}))).httpStatus,409);
 const body=payload();let r=await call(body);assert.equal(r.httpStatus,200,JSON.stringify(r));assert.equal(r.status,'returned');assert.equal(r.notificationSent,true);assert.equal(count(),1);assert.equal(calc().status,'returned');assert.equal(calc().version,1);assert.equal(calc().total,10000);assert.equal(calc().last_comment,'Уточните количество');assert.deepEqual(ctx.sent.map(x=>x.id),['gleb']);
 for(const value of ['Уточнил количество\nи время','Уточните количество','Мероприятий в группе: 2','Школа № 2','02.12.2026','?calculation=calc'])assert.ok(ctx.sent[0].text.includes(value),value);
 r=await call(body);assert.equal(r.duplicate,true);assert.equal(count(),1);assert.equal(ctx.sent.length,1);assert.equal((await call({...body,comment:'Другой ответ'})).httpStatus,409);
 r=await call(payload({resubmit:true}));assert.equal(r.httpStatus,200,JSON.stringify(r));assert.equal(calc().status,'approval');assert.equal(calc().current_approver_role,'coordinator');assert.equal(ctx.sent.length,2,'Reviewer receives only one notification');assert.equal(db.prepare("SELECT status FROM calculations WHERE id='calc2'").get().status,'draft','Sibling remains untouched');assert.equal((await call(payload())).httpStatus,409);
 // A reply to a stale return cannot be attached to a new return cycle.
 db.exec("UPDATE calculations SET status='returned',current_approver_role='' WHERE id='calc'; INSERT INTO calculation_history(calculation_id,actor_id,action,to_status,comment) VALUES('calc','gleb','return','returned','Новое замечание')");
 const returnId=Number(db.prepare('SELECT max(id) id FROM calculation_history WHERE action=\'return\'').get().id);
 assert.equal((await call(payload())).httpStatus,409);
 // Failed delivery still commits the answer; retries never add history or notifications twice.
 vm.runInContext('sendUserMessage=async()=>{throw Error("delivery failure")}',ctx);const failed=payload({returnId});r=await call(failed);assert.equal(r.httpStatus,200);assert.equal(r.notificationSent,false);assert.equal((await call(failed)).duplicate,true);
 // Detect concurrent approval or deletion before the atomic write.
 const oldCount=count();beforeBatch=()=>db.exec("UPDATE calculations SET status='approval' WHERE id='calc'");assert.equal((await call(payload({returnId}))).httpStatus,409);assert.equal(count(),oldCount);assert.equal(calc().status,'approval');
 db.exec("UPDATE calculations SET status='returned' WHERE id='calc'");beforeBatch=()=>db.exec("UPDATE calculations SET deleted_at=CURRENT_TIMESTAMP WHERE id='calc'");assert.equal((await call(payload({returnId}))).httpStatus,409);assert.equal(count(),oldCount);assert.ok(calc().deleted_at);assert.equal((await call(payload({returnId}))).httpStatus,404);
 db.exec("UPDATE calculations SET deleted_at=NULL,season_id='old-season' WHERE id='calc'");assert.equal((await call(payload({returnId}))).httpStatus,409);
 // Employee route restarts with Vil, with a separate reply notification to Gleb who returned it.
 db.exec("UPDATE calculations SET season_id='season',created_by='employee',approval_route='employee_vil_gleb' WHERE id='calc'");
 vm.runInContext('sent=[];sendUserMessage=async(env,id,text)=>{sent.push({id,text});return true}',ctx);
 const employeeReply=payload({returnId,resubmit:true});r=await call(employeeReply,'employee','employee');assert.equal(r.httpStatus,200,JSON.stringify(r));assert.equal(calc().status,'coordinator_review');assert.equal(calc().current_approver_role,'owner');assert.deepEqual(Array.from(ctx.sent,x=>x.id).sort(),['gleb','vil']);assert.equal((await call(employeeReply,'employee','employee')).duplicate,true);assert.equal(ctx.sent.length,2);
 // Ordinary approval submissions include all linked events and keep review per calculation.
 db.exec("UPDATE calculations SET created_by='vil',status='draft',approval_route='vil_to_gleb',current_approver_role='' WHERE id='calc'");ctx.sent.length=0;
 r=await call({id:'calc',action:'send_approval'},'vil','owner','customer','action');assert.equal(r.httpStatus,200,JSON.stringify(r));assert.ok(ctx.sent[0].text.includes('Мероприятий в группе: 2'));assert.ok(ctx.sent[0].text.includes('Встреча команды'));assert.ok(ctx.sent[0].text.includes('?calculation=calc'));
 // Batch context is scoped by season and author, excludes deleted calculations, and stays message-sized.
 db.exec("INSERT INTO calculations(id,event_id,event_title,created_by,season_id,batch_group) VALUES('unrelated','draft:event2','Скрытое','other','season','batch'),('past','draft:event2','Прошлый сезон','vil','past','batch')");
 for(let i=0;i<30;i++)db.prepare("INSERT INTO calculations(id,event_id,event_title,created_by,season_id,batch_group) VALUES(?,?,'Событие','vil','season','batch')").run('bulk-'+i,'draft:event2');
 ctx.calc=calc();const text=await vm.runInContext("calculationContextText(env,calc,'https://example.test')",ctx);assert.ok(text.includes('Мероприятий в группе: 32'));assert.ok(text.includes('Полный список'));assert.ok(text.length<1400);
 const workspace=await vm.runInContext('loadSharedWorkspace(env)',ctx);assert.ok(workspace.calculations.find(x=>x.id==='calc').history.some(h=>h.action==='reply'&&h.comment.includes('Уточнил')));
 console.log('PASS: reply migration, creator permissions, validation, return/version conflicts, atomic race guards, retry deduplication, failure-safe delivery, sequential resubmission, exact recipients, group context and notification links. No external messages sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
