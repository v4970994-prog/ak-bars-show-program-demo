const assert=require('node:assert/strict'),fixture=require('./employee-fixture.cjs');
(async()=>{
 const {db,c,call}=await fixture();
 const ok=r=>assert.equal(r.httpStatus,200,JSON.stringify(r));
 const assignment=(id='event',revision=1)=>({id,responsibleId:'artist',expectedRevision:revision});
 const calculation={eventId:'draft:event',eventTitle:'Урок хоккея event',items:[{id:'custom:lead',custom:true,name:'Ведущий',unit:'усл.',qty:2,unitPrice:1000}]};
 let r=await call('/api/bootstrap');ok(r);assert.equal(r.user.role,'employee');assert.equal(r.isAdmin,false);
 r=await call('/api/workspace');ok(r);assert.equal(r.user.role,'employee');assert.equal(r.user.organization,'customer');assert.equal(r.isOwner,false);
 // Assignment is allowed for own events, shared imports and matches, independent of authorship.
 for(const id of ['event','own','other-event','match']){ok(await call('/api/events/assign',assignment(id)));assert.equal(db.prepare('SELECT responsible_user_id FROM events WHERE id=?').get(id).responsible_user_id,'artist')}
 assert.equal(db.prepare('SELECT count(*) n FROM event_assignment_history WHERE actor_id=?').get('employee').n,4);
 assert.equal(c.sent.length,4);assert.ok(c.sent[0].text.includes('12.11.2026'));assert.ok(c.sent[0].text.includes('Контакт площадки'));
 assert.equal((await call('/api/events/assign',assignment())).httpStatus,409);
 for(const id of ['observer','artist'])assert.equal((await call('/api/events/assign',assignment('event',2),id)).httpStatus,403);
 assert.equal((await call('/api/events/assign',assignment('old-event'))).httpStatus,404);
 assert.equal((await call('/api/events/assign',assignment('missing'))).httpStatus,404);
 db.prepare('UPDATE events SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run('other-event');
 assert.equal((await call('/api/events/assign',assignment('other-event',2))).httpStatus,404);
 // Responsibility does not grant permission to change/delete another employee's calendar entry.
 assert.equal((await call('/api/events/update',{event:{id:'event'},expectedRevision:2})).httpStatus,403);
 assert.equal((await call('/api/events/delete',{ids:['event']})).httpStatus,403);
 // Actual authenticated employee creates a calculation and uses both coordinator stages.
 c.sent.length=0;r=await call('/api/calculations/save',calculation);ok(r);const id=r.id;
 const row=()=>db.prepare('SELECT * FROM calculations WHERE id=?').get(id);
 assert.equal(row().created_by,'employee');assert.equal(row().total,2000);assert.equal(row().approval_route,'employee_vil_gleb');
 ok(await call('/api/calculations/action',{id,action:'send_approval'}));assert.equal(row().status,'coordinator_review');assert.deepEqual(Array.from(c.sent,x=>x.id),['vil']);
 assert.equal((await call('/api/calculations/action',{id,action:'approve_stage'})).httpStatus,403);
 assert.equal((await call('/api/calculations/action',{id,action:'approve_stage'},'gleb')).httpStatus,403);
 assert.equal((await call('/api/calculations/action',{id,action:'approve'},'gleb')).httpStatus,409);
 ok(await call('/api/calculations/action',{id,action:'approve_stage'},'vil'));assert.equal(row().status,'approval');
 ok(await call('/api/calculations/action',{id,action:'approve'},'gleb'));assert.equal(row().status,'approved');
 assert.equal((await call('/api/calculations/save',{...calculation,id})).httpStatus,403);
 for(const who of ['observer','artist'])assert.equal((await call('/api/calculations/save',calculation,who)).httpStatus,403);
 // Linked MAX identity gets the canonical employee's role, not the old identity's performer role.
 r=await call('/api/workspace',{},'max:123');ok(r);assert.equal(r.user.id,'employee');assert.equal(r.user.role,'employee');
 ok(await call('/api/events/assign',{...assignment('match',2),responsibleId:'manager'},'max:123'));
 r=await call('/api/calculations/save',calculation,'max:123');ok(r);assert.equal(db.prepare('SELECT created_by FROM calculations WHERE id=?').get(r.id).created_by,'employee');
 // Role changes are returned on workspace refresh; status gates still precede all writes.
 db.prepare("UPDATE users SET role='executive' WHERE telegram_id='employee'").run();
 assert.equal((await call('/api/workspace')).user.role,'executive');
 db.prepare("UPDATE users SET status='blocked' WHERE telegram_id='employee'").run();
 assert.equal((await call('/api/events/assign',assignment('event',2))).httpStatus,401);
 assert.equal((await call('/api/calculations/save',calculation)).httpStatus,401);
 console.log('PASS: authenticated SKP employee creates calculations, follows Vil -> Gleb, assigns shared/match events, linked MAX identity and refreshed roles; observer/performer, stale, deleted, foreign-season, blocked and unrelated edit/delete access remain protected. No external messages sent.');
})().catch(error=>{console.error(error);process.exitCode=1});
