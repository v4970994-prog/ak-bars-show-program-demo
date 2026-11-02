const assert=require('node:assert/strict'),fixture=require('./events-export-fixture.cjs');
(async()=>{
 const {db,c,call,response}=await fixture();
 const filters={from:'2026-10-01',to:'2026-10-31',type:'all',team:'all'};
 const ids=r=>r.events.map(e=>e.id);
 for(const user of ['vil','gleb']){
  const r=await call('/api/events/export',filters,user);
  assert.equal(r.httpStatus,200,'active SKP coordinator can export');
  assert.deepEqual(ids(r),['start','other','bars','irbis','legacy','end'],'inclusive dates, chronological order, past events, no deleted/foreign/undated rows');
  assert.equal(r.season.code,'26/27');assert.deepEqual(r.filters,filters);
  const other=r.events.find(e=>e.id==='other');
  assert.equal(other.type,'event');assert.equal(other.team,'','legacy event team must not classify it as a match');
  assert.deepEqual([other.title,other.place,other.address,other.date,other.contact,other.phone,other.responsibleName,other.comment],['=2+2','Арена','Казань, улица Тестовая, 1','2026-10-15T10:30','Контакт площадки','+79000000000','Менеджер Подрядчика','<b>Текст</b> & "кавычки"\nВторая строка']);
 }
 for(const [type,team,want] of [
  ['matches','all',['start','bars','irbis','legacy']],
  ['matches','ak-bars',['start','legacy']],
  ['matches','bars',['bars']],
  ['matches','irbis',['irbis']],
  ['other','all',['other','end']],
 ])assert.deepEqual(ids(await call('/api/events/export',{...filters,type,team},'gleb')),want);
 assert.deepEqual(ids(await call('/api/events/export',{...filters,from:'2026-10-31'},'gleb')),['end'],'last day includes 23:59');
 assert.deepEqual(ids(await call('/api/events/export',{...filters,to:'2026-10-01'},'gleb')),['start'],'single day includes midnight');
 assert.deepEqual(ids(await call('/api/events/export',{...filters,from:'2026-10-02',to:'2026-10-03'},'gleb')),[],'no matches is an empty result, not a fallback');
 assert.deepEqual(ids(await call('/api/events/export',{...filters,from:'2028-02-29',to:'2028-02-29'},'gleb')),['leap']);
 for(const invalid of [
  {from:''},{to:''},{from:'2026-02-29'},{to:'2026-11-31'},{from:'2026-13-01'},
  {from:'2026-10-01T00:00'},{from:'2026-10-32'},{from:'2026-11-01'},
  {from:[]},{to:20261031},{type:'bogus'},{team:'bogus'},
  {type:'other',team:'bars'},{type:'all',team:'ak-bars'},
 ])assert.equal((await call('/api/events/export',{...filters,...invalid},'gleb')).httpStatus,400,JSON.stringify(invalid));
 for(const user of ['employee','other','observer','manager','artist','max:123'])assert.equal((await call('/api/events/export',filters,user)).httpStatus,403,user+' cannot export');
 assert.equal((await call('/api/events/export',{...filters,role:'coordinator',organization:'customer'},'manager')).httpStatus,403,'client cannot grant export permission');
 assert.equal((await response('/api/events/export',{...filters,webToken:'invalid-session'})).status,401);
 db.exec("UPDATE users SET role='coordinator' WHERE telegram_id='manager'");
 assert.equal((await call('/api/events/export',filters,'manager')).httpStatus,403,'contractor organization cannot gain SKP rights');
 db.exec("UPDATE users SET status='blocked' WHERE telegram_id='gleb'");
 assert.equal((await call('/api/events/export',filters,'gleb')).httpStatus,401,'role check does not bypass revoked access');
 db.exec("UPDATE users SET status='active' WHERE telegram_id='gleb'; UPDATE account_links SET canonical_user_id='gleb' WHERE identity_id='max:123'");
 assert.equal((await call('/api/events/export',filters,'max:123')).httpStatus,200,'linked identity uses canonical coordinator');
 db.exec("UPDATE events SET event_date='2026-11-02T13:00' WHERE id='end'");
 assert.deepEqual(ids(await call('/api/events/export',{...filters,type:'other'},'gleb')),['other'],'each export reads fresh stored dates');
 db.exec("UPDATE seasons SET status='archived'");
 assert.equal((await call('/api/events/export',filters,'gleb')).httpStatus,409,'no active season is explicit');
 assert.equal(c.sent.length,0,'read-only export sends no messages');
 console.log('PASS: coordinator event export authorization, linked identities, inclusive dates, teams/types, sorting, fresh data, season/deletion isolation and validation. No real notifications sent.');
})().catch(error=>{console.error(error);process.exitCode=1});
