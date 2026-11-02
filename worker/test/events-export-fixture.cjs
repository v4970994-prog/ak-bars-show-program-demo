const fixture=require('./employee-fixture.cjs');
module.exports=async function eventsExportFixture(){
 const result=await fixture(),{db}=result;
 db.exec('DELETE FROM events');
 const rows=[
  ['before','event','','2026-09-30T23:59','season',null],
  ['start','match','ak-bars','2026-10-01T00:00','season',null],
  ['other','event','ak-bars','2026-10-15T10:30','season',null],
  ['bars','match','bars','2026-10-20T12:00','season',null],
  ['irbis','match','irbis','2026-10-20T12:00','season',null],
  ['legacy','match','','2026-10-21T18:00','season',null],
  ['end','event','','2026-10-31T23:59','season',null],
  ['after','match','ak-bars','2026-11-01T00:00','season',null],
  ['deleted','event','','2026-10-10T09:00','season','2026-10-11'],
  ['old','match','bars','2026-10-11T09:00','old-season',null],
  ['undated','event','','','season',null],
  ['leap','event','','2028-02-29T15:00','season',null],
 ];
 for(const [id,type,team,date,season,deleted] of rows){
  db.prepare('INSERT INTO events(id,event_type,team,title,place,address,event_date,contact_name,contact_phone,comment,responsible_user_id,created_by,season_id,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,type,team,'Событие '+id,'Арена','Казань, улица Тестовая, 1',date,'Контакт площадки','+79000000000','Комментарий','manager','vil',season,deleted);
 }
 db.prepare("UPDATE events SET title=?,comment=? WHERE id='other'").run('=2+2','<b>Текст</b> & "кавычки"\nВторая строка');
 db.prepare("UPDATE users SET first_name='Менеджер',last_name='Подрядчика' WHERE telegram_id='manager'").run();
 return result;
};
