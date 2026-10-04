const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
const db=new DatabaseSync(':memory:');
const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)||null},async all(){return {results:db.prepare(sql).all(...this.args)}},async run(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
const ctx=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console,crypto:crypto.webcrypto});
vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),ctx);ctx.env=env;ctx.sent=[];
async function call(body,role='owner',id='vil',organization='customer',endpoint='assign'){
 ctx.testAuth={body,user:{id},databaseUser:{role,organization}};
 const r=await ctx.worker.fetch(new Request('https://example.test/api/events/'+endpoint,{method:'POST'}),env);return {status:r.status,...await r.json()};
}
const payload=(responsibleId='artist',expectedRevision=1)=>({id:'event',responsibleId,expectedRevision});
(async()=>{
 await vm.runInContext('initializeSchema(env)',ctx);await vm.runInContext('initializeSchema(env)',ctx);
 db.exec("INSERT INTO seasons(id,code,created_by) VALUES('season','26/27','vil'); INSERT INTO events(id,title,place,address,event_date,contact_name,contact_phone,created_by,season_id) VALUES('event','Урок хоккея','Школа','Тестовый адрес','2026-11-02T10:30','Контакт','+70000000000','leysan','season')");
 const add=db.prepare('INSERT INTO users(telegram_id,first_name,last_name,organization,role,status) VALUES(?,?,?,?,?,?)');
 for(const row of [['manager','Менеджер','','contractor','contractor_manager','active'],['artist','Артист','','contractor','performer','active'],['blocked','Блок','','contractor','performer','blocked'],['employee','Сотрудник','','customer','employee','active']])add.run(...row);
 vm.runInContext('requireActive=async()=>testAuth;sendUserMessage=async(env,id,text)=>{sent.push({id,text});return true}',ctx);
 for(const [role,id,org] of [['performer','artist','contractor'],['executive','stas','customer'],['employee','other','customer'],['contractor_manager','fake','customer']])assert.equal((await call(payload(),role,id,org)).status,403);
 for(const invalid of ['blocked','employee','unknown'])assert.equal((await call(payload(invalid))).status,400);
 assert.equal((await call(payload('artist',0))).status,409);assert.equal(ctx.sent.length,0);
 let r=await call(payload(),'employee','leysan');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.notificationSent,true);assert.equal(ctx.sent.length,1);assert.equal(ctx.sent[0].id,'artist');
 for(const text of ['Урок хоккея','02.11.2026','10:30','Школа','Тестовый адрес','Контакт','+70000000000','?event=event'])assert.ok(ctx.sent[0].text.includes(text),text);
 assert.equal(db.prepare('SELECT count(*) n FROM event_assignment_history').get().n,1);
 assert.equal((await call(payload())).status,409);r=await call(payload('artist',2));assert.equal(r.unchanged,true);assert.equal(ctx.sent.length,1,'No duplicate notifications');
 r=await call(payload('manager',2),'contractor_manager','manager','contractor');assert.equal(r.status,200);assert.equal(ctx.sent.length,3,'New and previous responsible notified');
 assert.equal(ctx.sent[1].id,'manager');assert.ok(ctx.sent[2].text.includes('больше не'));
 ctx.sent.length=0;
 ctx.calculation={event_id:'draft:event',event_title:'Старое название',total:12345,created_by:'manager',created_by_name:'Менеджер'};
 await vm.runInContext("notifyContractorManagersApproved(env,calculation,'https://example.test')",ctx);assert.equal(ctx.sent.length,1,'Manager and responsible is one recipient');assert.ok(ctx.sent[0].text.includes('Урок хоккея'));
 await call(payload('artist',3));ctx.sent.length=0;
 await vm.runInContext("notifyContractorManagersApproved(env,calculation,'https://example.test')",ctx);assert.deepEqual(ctx.sent.map(x=>x.id).sort(),['artist','manager']);
 let workspace=await vm.runInContext('loadSharedWorkspace(env)',ctx);assert.equal(workspace.events[0].responsibleId,'artist');assert.equal(workspace.events[0].responsibleName,'Артист');
 ctx.sent.length=0;r=await call({event:{id:'event',title:'Урок хоккея',place:'Школа',address:'Тестовый адрес',date:'2026-11-03T11:00',contact:'Контакт',phone:'+70000000000',comment:''},expectedRevision:4},'owner','vil','customer','update');assert.equal(r.status,200,JSON.stringify(r));assert.equal(ctx.sent.length,1);assert.ok(ctx.sent[0].text.includes('03.11.2026'));
 // Sending failure must not report a failed save or trigger duplicate writes on retry.
 vm.runInContext('sendUserMessage=async()=>false',ctx);r=await call(payload('manager',5));assert.equal(r.status,200);assert.equal(r.notificationSent,false);assert.equal(db.prepare('SELECT responsible_user_id FROM events').get().responsible_user_id,'manager');
 r=await call(payload('',6));assert.equal(r.status,200);assert.equal(db.prepare('SELECT responsible_user_id FROM events').get().responsible_user_id,'');
 // Exercise actual channel selection with linked identities; all delivery calls stay mocked.
 vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').match(/async function sendUserMessage\([\s\S]*?\n}\n/)[0],ctx);
 db.exec("INSERT INTO account_links(identity_id,canonical_user_id,created_by) VALUES('max:123','artist','vil'); UPDATE users SET notification_preference='max' WHERE telegram_id='artist'");
 vm.runInContext('sent=[];directUserMessage=async(env,id,text)=>{sent.push({id,text});return true}',ctx);
 await vm.runInContext("sendUserMessage(env,'artist','Тест')",ctx);assert.deepEqual(Array.from(ctx.sent,x=>x.id),['max:123']);
 console.log('PASS: responsibility permissions, active contractor validation, revisions, audit, assignment/transfer/removal, notification contents, approval deduplication, event changes, failed notification persistence, linked MAX preference. No external messages sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
