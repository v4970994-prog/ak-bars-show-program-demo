const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
const source=fs.readFileSync(__dirname+'/../src/worker.js','utf8');
const db=new DatabaseSync(':memory:');
const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)||null},async all(){return {results:db.prepare(sql).all(...this.args)}},async run(){const out=db.prepare(sql).run(...this.args);return {meta:{changes:out.changes}}}}},async batch(statements){db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results}catch(error){db.exec('ROLLBACK');throw error}}}};
const c=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console,crypto:crypto.webcrypto});
vm.runInContext(source.replace('export default {','globalThis.worker = {'),c);
c.env=env;
async function call(endpoint,body,role='owner',userId='vil',organization='customer'){
  c.testAuth={body,user:{id:userId},databaseUser:{role,organization}};
  const response=await c.worker.fetch(new Request('https://example.test/api/events/'+endpoint,{method:'POST'}),env);
  return {status:response.status,...await response.json()};
}
function event(title='Урок хоккея',date='2026-10-07T10:30',place='Школа №135'){return {type:'event',title,place,address:'Казань, адрес',date,contact:'Тестовый контакт',phone:'+70000000000',comment:'Excel'}}
function rows(){return db.prepare('SELECT * FROM events WHERE deleted_at IS NULL').all()}
(async()=>{
 await vm.runInContext('initializeSchema(env)',c);
 await vm.runInContext('initializeSchema(env)',c); // idempotent migration
 db.prepare("INSERT INTO seasons(id,code,status,created_by) VALUES ('season','26/27','active','vil')").run();
 vm.runInContext('requireActive=async()=>testAuth',c);
 let r=await call('import',{events:[event(),event('Незаполненное','')]});assert.equal(r.status,400);assert.equal(rows().length,0,'No partial import');
 r=await call('import',{events:Array.from({length:101},()=>event())});assert.equal(r.status,400);assert.equal(rows().length,0,'No silent truncation');
 r=await call('import',{events:[event()]},'contractor_manager','kirill','contractor');assert.equal(r.status,403);
 r=await call('import',{events:[event(),event('  урок   ХОККЕЯ  ')]});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.added,1);assert.equal(r.skipped,1);
 const first=rows()[0];assert.equal(first.event_type,'event');assert.equal(first.contact_phone,'+70000000000');
 r=await call('import',{events:[event()]});assert.equal(r.added,0);assert.equal(r.skipped,1);
 r=await call('import',{events:[event('Bad','2026-02-30T09:00')]});assert.equal(r.status,400);assert.equal(rows().length,1);
 r=await call('import',{events:[{...event(),type:'match'}]});assert.equal(r.status,400);
 r=await call('update',{event:{...event(),id:first.id},expectedRevision:1},'employee','other');assert.equal(r.status,403);
 r=await call('update',{event:{...event(),id:first.id},expectedRevision:1},'executive');assert.equal(r.status,403);
 const calcSQL="INSERT INTO calculations(id,event_id,event_title,created_by,created_by_name,organization,season_id,status,total) VALUES (?,?,?,'vil','Виль','customer','season','approved',500)";
 db.prepare(calcSQL).run('calc','draft:'+first.id,first.title);
 r=await call('update',{event:{...event('Новое название','2026-12-08T12:00'),id:first.id,type:'match'},expectedRevision:1});assert.equal(r.status,200,JSON.stringify(r));
 let changed=rows()[0];assert.equal(changed.event_type,'event');assert.equal(changed.id,first.id);assert.equal(changed.created_by,'vil');assert.equal(changed.revision,2);
 assert.equal(db.prepare('SELECT event_title FROM calculations').get().event_title,'Новое название');
 assert.equal(db.prepare('SELECT total FROM calculations').get().total,500);
 r=await call('update',{event:{...event(),id:first.id},expectedRevision:1});assert.equal(r.status,409,'Stale update rejected');
 r=await call('save',{event:{...event(),id:first.id}});assert.equal(r.status,409,'Legacy save cannot bypass revision');
 r=await call('import',{events:[event('Второе','2026-10-10T11:00')]});assert.equal(r.added,1);
 const second=rows().find(x=>x.id!==first.id);
 r=await call('delete',{ids:[first.id,second.id]});assert.equal(r.status,409);assert.equal(rows().length,2,'Blocked bulk delete changes nothing');
 r=await call('delete',{ids:[second.id]},'employee','stranger');assert.equal(r.status,403);
 r=await call('delete',{ids:[second.id]},'contractor_manager','kirill','contractor');assert.equal(r.status,403);
 db.prepare("UPDATE calculations SET deleted_at=CURRENT_TIMESTAMP WHERE id='calc'").run();
 r=await call('delete',{ids:[first.id,second.id]});assert.equal(r.status,200);assert.equal(r.deleted,2);assert.equal(rows().length,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM calculations').get().n,1,'Calculation history retained');
 assert.throws(()=>db.prepare(calcSQL).run('stale-calc','draft:'+first.id,'Deleted'),/Событие удалено/);
 r=await call('save',{event:{...event(),id:first.id}});assert.equal(r.status,409,'Cannot resurrect deleted id');
 r=await call('import',{events:[event()]});assert.equal(r.added,1,'Reimport after deletion works');
 r=await call('save',{event:{...event('Ак Барс — Барс','2026-10-08T19:00','Арена'),type:'match',team:'ak-bars',address:''}});assert.equal(r.status,200,JSON.stringify(r));const matchId=r.id;
 db.prepare(calcSQL).run('match-calc','draft:'+matchId,'Ак Барс — Барс');
 r=await call('delete',{ids:[matchId]});assert.equal(r.status,400);assert.ok(rows().find(x=>x.id===matchId));
 r=await call('update',{event:{...event('Ак Барс — Барс','2026-11-02T18:30','Арена'),id:matchId,address:'',type:'event',team:'irbis'},expectedRevision:1},'coordinator','gleb');assert.equal(r.status,200,JSON.stringify(r));
 const match=rows().find(x=>x.id===matchId);assert.equal(match.event_type,'match');assert.equal(match.team,'ak-bars');assert.equal(match.event_date,'2026-11-02T18:30');assert.equal(db.prepare("SELECT event_id FROM calculations WHERE id='match-calc'").get().event_id,'draft:'+matchId);
 db.prepare("INSERT INTO events(id,title,created_by,event_date,place,season_id) VALUES ('foreign','Другой сезон','vil','2027-01-01T10:00','Арена','other')").run();
 r=await call('delete',{ids:['foreign']});assert.equal(r.status,409);
 r=await call('update',{event:{...event(),id:'foreign'},expectedRevision:1});assert.equal(r.status,404);
 // Employee can edit/delete only the events they created.
 r=await call('import',{events:[event('Своё','2026-10-11T11:00')]},'employee','leysan');assert.equal(r.added,1);
 const own=rows().find(x=>x.created_by==='leysan');
 r=await call('update',{event:{...event('Своё','2026-10-11T12:00'),id:own.id},expectedRevision:1},'employee','leysan');assert.equal(r.status,200);
 r=await call('delete',{ids:[own.id]},'employee','leysan');assert.equal(r.status,200);
 // Inspect actual client functions against persisted event/approved calculation state.
 const html=await (await c.worker.fetch(new Request('https://example.test/'),{})).text();
 for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))if(m[1].trim())new vm.Script(m[1]);
 const workspace=await vm.runInContext('loadSharedWorkspace(env)',c);assert.equal(workspace.events.find(e=>e.id===matchId).revision,2);
 const ui=vm.createContext({state:{drafts:workspace.events,matches:[],requests:workspace.calculations}});
 const functions=['exportEventForCalculation','approvedCalculationsByMatch','matchMonthKey'];
 for(const name of functions){const lines=html.split('\n'),start=lines.findIndex(l=>new RegExp('^    function '+name+'\\(').test(l));let end=start;if(!lines[start].endsWith('}')){end++;while(!/^    }/.test(lines[end]))end++}vm.runInContext(lines.slice(start,end+1).join('\n'),ui)}
 assert.equal(Object.keys(vm.runInContext("approvedCalculationsByMatch('ak-bars','2026-10')",ui)).length,0);
 assert.equal(Object.keys(vm.runInContext("approvedCalculationsByMatch('ak-bars','2026-11')",ui)).length,1);
 console.log('PASS: real SQLite migration/idempotency, atomic import validation, deduplication/reimport, role and season checks, revision conflicts, bulk delete/link protection, deleted-event calculation guard, match move with retained ID/calculations, specification month changes, Worker/inline syntax.');
})().catch(error=>{console.error(error);process.exitCode=1});
