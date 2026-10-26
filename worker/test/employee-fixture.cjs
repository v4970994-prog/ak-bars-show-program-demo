// Real Worker + SQLite + browser sessions. Only delivery is mocked.
const fs=require('node:fs'),vm=require('node:vm'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
module.exports=async function employeeFixture(){
 const db=new DatabaseSync(':memory:');
 const env={DB:{prepare(sql){return {args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)||null},async all(){return {results:db.prepare(sql).all(...this.args)}},async run(){return {meta:{changes:db.prepare(sql).run(...this.args).changes}}}}},async batch(statements){db.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}}};
 const c=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console,crypto:crypto.webcrypto});c.env=env;c.sent=[];
 vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),c);
 await vm.runInContext('initializeSchema(env)',c);
 db.exec("INSERT INTO seasons(id,code,created_by) VALUES('season','26/27','vil'); INSERT INTO seasons(id,code,created_by,status) VALUES('old-season','25/26','vil','archived')");
 const people=[['employee','employee','customer'],['other','employee','customer'],['vil','owner','customer'],['gleb','coordinator','customer'],['observer','executive','customer'],['manager','contractor_manager','contractor'],['artist','performer','contractor'],['max:123','performer','contractor']];
 for(const [id,role,organization] of people){
  db.prepare("INSERT INTO users(telegram_id,first_name,role,organization,status) VALUES(?,?,?,?,'active')").run(id,id,role,organization);
  db.prepare('INSERT INTO web_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update('local-token-'+id).digest('hex'),id,Math.floor(Date.now()/1000)+3600);
 }
 db.exec("INSERT INTO account_links(identity_id,canonical_user_id,created_by) VALUES('max:123','employee','vil')");
 for(const [id,creator,type,season] of [['event','vil','event','season'],['own','employee','event','season'],['other-event','other','event','season'],['match','vil','match','season'],['old-event','vil','event','old-season']]){
  db.prepare('INSERT INTO events(id,event_type,team,title,place,address,event_date,contact_name,contact_phone,created_by,season_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,type,type==='match'?'ak-bars':'',type==='match'?'Ак Барс - Соперник':'Урок хоккея '+id,'Тестовая площадка','Тестовый адрес','2026-11-12T10:30','Контакт площадки','+79000000000',creator,season);
 }
 vm.runInContext('sendUserMessage=async(env,id,text)=>{sent.push({id:String(id),text});return true}',c);
 async function response(path,body={},id='employee'){
  return c.worker.fetch(new Request('https://local.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({webToken:'local-token-'+id,...body})}),env);
 }
 async function call(path,body={},id='employee'){const r=await response(path,body,id);return {httpStatus:r.status,...await r.json()}}
 return {db,c,env,response,call};
};
