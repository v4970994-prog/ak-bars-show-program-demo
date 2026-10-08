// Group approval regression suite: real SQLite transactions, no external delivery.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
const db=new DatabaseSync(':memory:');let beforeBatch=null,failAt=-1,serial=0;
const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)||null},async all(){return {results:db.prepare(sql).all(...this.args)}},async run(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}}},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=null;hook()}db.exec('BEGIN');try{const out=[];for(let i=0;i<statements.length;i++){if(i===failAt){failAt=-1;throw Error('Simulated write failure')}out.push(await statements[i].run())}db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
const c=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console,crypto:crypto.webcrypto});c.env=env;c.sent=[];
vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),c);
const key=()=> 'group-local-key-'+(++serial);
const item=(price=39474)=>({id:'custom:lead',custom:true,name:'Ведущий',unit:'усл.',qty:1,unitPrice:price});
async function call(endpoint,body,id='vil'){
 const person=db.prepare('SELECT * FROM users WHERE telegram_id=?').get(id);
 c.auth={body,user:{id,first_name:person.first_name},databaseUser:person};
 const r=await c.worker.fetch(new Request('https://example.test/api/calculations/'+endpoint,{method:'POST'}),env);
 return {httpStatus:r.status,...await r.json()};
}
const rows=group=>db.prepare('SELECT * FROM calculations WHERE batch_group=? AND deleted_at IS NULL ORDER BY id').all(group);
async function bodyFor(id,extra={}){
 const workspace=await vm.runInContext('loadSharedWorkspace(env)',c),row=workspace.calculations.find(r=>r.id===id);
 assert.ok(row,id);return {id,groupRevision:row.groupRevision,requestKey:key(),...extra};
}
async function workflow(id,action,user='vil',extra={}){return call('action',await bodyFor(id,{action,...extra}),user)}
const expectOk=r=>assert.equal(r.httpStatus,200,JSON.stringify(r));
function seed(group,creator='vil',status='draft',route='vil_to_gleb',count=9){
 for(let i=1;i<=count;i++){
   const id=group+'-'+i;
   db.prepare("INSERT INTO calculations(id,event_id,event_title,created_by,created_by_name,organization,season_id,approval_route,status,total,batch_group,current_approver_role) VALUES(?,?,'Урок хоккея',?,'Автор','customer','season',?,?,39474,?,?)").run(id,'draft:event'+i,creator,route,status,group,status==='approval'?'coordinator':status==='coordinator_review'?'owner':'');
   db.prepare("INSERT INTO calculation_items(calculation_id,service_id,name,unit,quantity,unit_price,line_total) VALUES(?,'custom:lead','Ведущий','усл.',1,39474,39474)").run(id);
 }
 return group+'-1';
}
(async()=>{
 await vm.runInContext('initializeSchema(env)',c);await vm.runInContext('initializeSchema(env)',c);
 db.exec("INSERT INTO seasons(id,code,created_by) VALUES('season','26/27','vil')");
 for(const [id,role,organization] of [['vil','owner','customer'],['gleb','coordinator','customer'],['employee','employee','customer'],['manager','contractor_manager','contractor'],['artist','performer','contractor'],['observer','executive','customer']])db.prepare('INSERT INTO users(telegram_id,first_name,role,status,organization) VALUES(?,?,?,\'active\',?)').run(id,id,role,organization);
 for(let i=1;i<=12;i++)db.prepare("INSERT INTO events(id,title,place,address,event_date,created_by,season_id,responsible_user_id,contact_name,contact_phone) VALUES(?,'Урок хоккея',?,?,?,'vil','season',?,'Контакт школы','+79000000000')").run('event'+i,'Школа № '+i,'Адрес '+i,(i<5?'2026-10-':'2026-11-')+String(i+10).padStart(2,'0')+'T10:30',i===1?'manager':i===2?'artist':'');
 vm.runInContext('requireActive=async()=>auth;sendUserMessage=async(env,id,text)=>{sent.push({id:String(id),text});return true}',c);
 // Existing nine rows become a single workflow without creating/deleting event accounting.
 const first=seed('legacy');let r;
 assert.equal((await call('action',{id:first,action:'send_approval'})).httpStatus,400);
 assert.equal((await workflow(first,'send_approval','manager')).httpStatus,403);
 c.sent.length=0;r=await workflow(first,'send_approval');expectOk(r);assert.equal(r.affected,9);
 assert.ok(rows('legacy').every(row=>row.status==='approval'&&row.current_approver_role==='coordinator'));
 assert.deepEqual(Array.from(c.sent,x=>x.id),['gleb']);assert.ok(c.sent[0].text.includes('355'));assert.ok(c.sent[0].text.includes('Мероприятий: 9'));
 assert.equal((await workflow(first,'approve')).httpStatus,403);
 const stale=await bodyFor(first,{action:'approve'});
 beforeBatch=()=>db.prepare("UPDATE calculations SET version=version+1 WHERE id='legacy-5'").run();
 assert.equal((await call('action',stale,'gleb')).httpStatus,409);assert.ok(rows('legacy').every(row=>row.status==='approval'));assert.equal(db.prepare("SELECT count(*) n FROM calculation_history WHERE action='approve'").get().n,0);
 const approval=await bodyFor(first,{action:'approve'});c.sent.length=0;r=await call('action',approval,'gleb');expectOk(r);assert.equal(r.affected,9);
 assert.ok(rows('legacy').every(row=>row.status==='approved'));assert.equal(rows('legacy').reduce((sum,row)=>sum+row.total,0),355266);
 assert.deepEqual(Array.from(c.sent,x=>x.id).sort(),['artist','manager','vil']);
 assert.ok(c.sent.every(x=>x.text.includes('Мероприятий: 9')&&x.text.includes('Контакт школы')&&x.text.length<4000));
 const notificationCount=c.sent.length;assert.equal((await call('action',approval,'gleb')).duplicate,true);assert.equal(c.sent.length,notificationCount);
 assert.equal((await call('action',{...approval,comment:'changed'},'gleb')).httpStatus,409);
 // Atomic creation with one idempotency key and no credential storage.
 const create={eventIds:['draft:event1','draft:event2','draft:event3'],items:[item()],requestKey:key(),initData:'never-persist-auth',webToken:'never-persist-token'};
 assert.equal((await call('save-batch',create,'artist')).httpStatus,403);
 r=await call('save-batch',create,'employee');expectOk(r);const groupId=r.groupId,id=r.id;
 assert.equal(rows(groupId).length,3);assert.equal(db.prepare('SELECT count(*) n FROM calculation_items WHERE calculation_id IN (SELECT id FROM calculations WHERE batch_group=?)').get(groupId).n,3);
 assert.equal((await call('save-batch',{...create,initData:'refreshed-auth'},'employee')).duplicate,true);
 assert.ok(!db.prepare('SELECT payload FROM calculation_operations WHERE request_key=?').get(create.requestKey).payload.includes('persist'));
 const beforeCount=db.prepare('SELECT count(*) n FROM calculations').get().n;
 assert.equal((await call('save-batch',{...create,requestKey:key(),eventIds:['draft:event1','draft:missing']},'employee')).httpStatus,400);
 assert.equal(db.prepare('SELECT count(*) n FROM calculations').get().n,beforeCount);
 failAt=2;r=await call('save-batch',{...create,requestKey:key()},'employee');assert.equal(r.httpStatus,503);assert.equal(db.prepare('SELECT count(*) n FROM calculations').get().n,beforeCount);
 // Employee route: one send, Vil's stage for all, one return by Gleb, one reply.
 c.sent.length=0;expectOk(await workflow(id,'send_approval','employee'));assert.deepEqual(Array.from(c.sent,x=>x.id),['vil']);
 assert.ok(rows(groupId).every(row=>row.status==='coordinator_review'));
 c.sent.length=0;expectOk(await workflow(id,'approve_stage','vil'));assert.ok(rows(groupId).every(row=>row.status==='approval'));assert.deepEqual(Array.from(c.sent,x=>x.id).sort(),['employee','gleb']);
 c.sent.length=0;expectOk(await workflow(id,'return','gleb',{comment:'Уточните количество'}));assert.ok(rows(groupId).every(row=>row.status==='returned'));assert.deepEqual(Array.from(c.sent,x=>x.id),['employee']);
 // Group edits replace all pending compositions in one transaction.
 const originalVersion=rows(groupId)[0].version;
 r=await call('save',await bodyFor(id,{eventId:db.prepare('SELECT event_id FROM calculations WHERE id=?').get(id).event_id,items:[item(42000)]}),'employee');expectOk(r);
 assert.ok(rows(groupId).every(row=>row.total===42000&&row.version===originalVersion+1&&row.status==='returned'));
 const returnedId=db.prepare("SELECT max(id) id FROM calculation_history WHERE action='return' AND calculation_id IN (SELECT id FROM calculations WHERE batch_group=?)").get(groupId).id;
 let reply=await bodyFor(id,{comment:'Исправил общий расчёт',returnId:returnedId,expectedVersion:rows(groupId)[0].version,resubmit:false});c.sent.length=0;
 r=await call('reply',reply,'employee');expectOk(r);assert.ok(rows(groupId).every(row=>row.status==='returned'));assert.deepEqual(Array.from(c.sent,x=>x.id),['gleb']);
 assert.equal((await call('reply',reply,'employee')).duplicate,true);assert.equal(c.sent.length,1);
 reply=await bodyFor(id,{comment:'Готово, повторно отправляю',returnId:returnedId,expectedVersion:rows(groupId)[0].version,resubmit:true});c.sent.length=0;expectOk(await call('reply',reply,'employee'));
 assert.ok(rows(groupId).every(row=>row.status==='coordinator_review'));assert.deepEqual(Array.from(c.sent,x=>x.id).sort(),['gleb','vil']);
 expectOk(await workflow(id,'approve_stage'));c.sent.length=0;expectOk(await workflow(id,'approve','gleb'));
 assert.deepEqual(Array.from(c.sent,x=>x.id).sort(),['artist','employee','manager']);assert.equal(rows(groupId).reduce((sum,row)=>sum+row.total,0),126000);
 // Partial legacy groups keep prior final decisions and finish remaining rows together.
 const partial=seed('partial','vil','draft','vil_to_gleb',3);
 db.prepare("UPDATE calculations SET status='approved',approved_by='original',approved_at='2026-10-01' WHERE id=?").run(partial);
 expectOk(await workflow(partial,'send_approval'));assert.equal(rows('partial').find(row=>row.id===partial).approved_by,'original');
 r=await workflow(partial,'approve','gleb');expectOk(r);assert.equal(r.affected,2);assert.ok(rows('partial').every(row=>row.status==='approved'));assert.equal(rows('partial')[0].approved_at,'2026-10-01');
 // A factual correction for one event must not alter the other eight dates.
 const factBefore=rows('partial').map(row=>({id:row.id,total:row.total,version:row.version}));
 r=await call('save',await bodyFor(partial,{eventId:'draft:event1',items:[item(50000)],scope:'event'}));expectOk(r);assert.equal(r.affected,1);
 assert.equal(rows('partial')[0].total,50000);
 assert.deepEqual(rows('partial').slice(1).map(row=>({id:row.id,total:row.total,version:row.version})),factBefore.slice(1));
 assert.equal((await call('save-batch',{...create,requestKey:key(),eventIds:['draft:event1','event1']},'employee')).httpStatus,400);
 // Mixed old stages cannot skip Vil: only first-stage rows advance, then one final approval.
 const mixed=seed('mixed','employee','coordinator_review','employee_vil_gleb',3);
 db.prepare("UPDATE calculations SET status='approval',current_approver_role='coordinator' WHERE id=?").run(mixed);
 assert.equal((await workflow(mixed,'approve','gleb')).httpStatus,403);
 expectOk(await workflow(mixed,'approve_stage'));assert.ok(rows('mixed').every(row=>row.status==='approval'));expectOk(await workflow(mixed,'approve','gleb'));
 // Gleb's own group is approved once by Vil, not by its author.
 const gleb=seed('gleb-batch','gleb','draft','gleb_to_vil',2);
 expectOk(await workflow(gleb,'send_approval','gleb'));expectOk(await workflow(gleb,'approve_stage'));assert.ok(rows('gleb-batch').every(row=>row.status==='approved'));
 // Transaction failure never leaves half the group approved.
 const failure=seed('rollback','vil','approval','vil_to_gleb',3);
 const failingBody=await bodyFor(failure,{action:'approve'});failAt=2;c.sent.length=0;
 assert.equal((await call('action',failingBody,'gleb')).httpStatus,503);assert.ok(rows('rollback').every(row=>row.status==='approval'));assert.equal(c.sent.length,0);
 assert.equal(db.prepare('SELECT count(*) n FROM calculation_operations WHERE request_key=?').get(failingBody.requestKey).n,0);
 // Membership changes, other authors/seasons, and cancelled/deleted rows are respected.
 const scoped=seed('scope','vil','approval','vil_to_gleb',3);
 db.exec("INSERT INTO calculations(id,event_id,event_title,created_by,season_id,batch_group,status) VALUES('outsider','draft:event1','Чужой','employee','season','scope','draft'),('old','draft:event1','Старый','vil','old-season','scope','draft')");
 const scopedBody=await bodyFor(scoped,{action:'approve'});
 beforeBatch=()=>db.exec("UPDATE calculations SET deleted_at=CURRENT_TIMESTAMP WHERE id='scope-3'");
 assert.equal((await call('action',scopedBody,'gleb')).httpStatus,409);assert.equal(db.prepare("SELECT status FROM calculations WHERE id='scope-1'").get().status,'approval');
 expectOk(await workflow(scoped,'approve','gleb'));assert.equal(db.prepare("SELECT status FROM calculations WHERE id='outsider'").get().status,'draft');assert.equal(db.prepare("SELECT status FROM calculations WHERE id='old'").get().status,'draft');
 // Failure to deliver does not undo approval or duplicate it on retry.
 const delivery=seed('delivery','vil','approval','vil_to_gleb',2);const deliveryBody=await bodyFor(delivery,{action:'approve'});
 vm.runInContext('sendUserMessage=async()=>{throw Error("Delivery failed")}',c);
 r=await call('action',deliveryBody,'gleb');expectOk(r);assert.equal(r.notificationSent,false);assert.ok(rows('delivery').every(row=>row.status==='approved'));assert.equal((await call('action',deliveryBody,'gleb')).duplicate,true);
 // Exclude one cancelled event explicitly; the remaining calculation stays approved.
 const removeBody=await bodyFor(first,{confirmation:'УДАЛИТЬ',scope:'event'});
 r=await call('delete',removeBody);expectOk(r);assert.equal(r.deleted,1);assert.equal(rows('legacy').length,8);assert.equal((await call('delete',removeBody)).duplicate,true);
 const remaining=rows('legacy')[0].id;r=await call('delete',await bodyFor(remaining,{confirmation:'УДАЛИТЬ',scope:'group'}));expectOk(r);assert.equal(r.deleted,8);assert.equal(rows('legacy').length,0);
 assert.equal((await call('save',{id:first,eventId:'draft:event1',items:[item()]})).httpStatus,404);
 console.log('PASS: legacy nine-event groups, one decision/notification, all approval routes, group returns/replies/edits, atomic creation and rollback, retries, stale membership/content, partial approvals, season/author isolation, event exclusion, preserved per-event accounting. No external messages sent.');
})().catch(error=>{console.error(error);process.exitCode=1});
