const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const c=vm.createContext({URL,Request,Response,TextEncoder,TextDecoder,console});
vm.runInContext(fs.readFileSync(__dirname+'/../src/worker.js','utf8').replace('export default {','globalThis.worker={'),c);
(async()=>{
 const html=await(await c.worker.fetch(new Request('https://test/'),{})).text(),lines=html.split('\n');
 const state={user:{organization:'customer',role:'owner'},drafts:[
 {id:'ak',type:'match',team:'ak-bars',date:'2026-10-04T19:00'},
 {id:'bars',type:'match',team:'bars',date:'2026-10-03T19:00'},
 {id:'irbis',type:'match',team:'irbis',date:'2026-10-03T19:00'},
 {id:'other',type:'event',team:'ak-bars',date:'2026-10-04T19:00'},
 {id:'future',type:'event',date:'2026-10-04T23:00'},
 {id:'tomorrow',type:'match',team:'ak-bars',date:'2026-10-05T19:00'},
 {id:'invalid',type:'event',date:'garbage'}],matches:[],requests:[]};
 const ui=vm.createContext({state,monthlyStandardData:team=>({perMatchTotal:{'ak-bars':1000,bars:2000,irbis:3000}[team],rows:[]})});
 for(const name of ['exportEventForCalculation','calculationTeam','eventMatchesFilter','canSeeSpentSummary','elapsedEvent','spentSummaryData']){let a=lines.findIndex(l=>l.startsWith('    function '+name+'(')),b=a;if(!lines[a].endsWith('}')){b++;while(!lines[b].startsWith('    }'))b++}vm.runInContext(lines.slice(a,b+1).join('\n'),ui)}
 for(const [id,event,status,total] of [['c1','other','approved',500],['c2','other','approved',250],['c3','ak','approved',100],['c4','other','draft',9000],['c5','future','approved',8000],['c6','missing','approved',7000],['c7','other','approved',6000]])state.requests.push({id,event:'draft:'+event,team:'ak-bars',status,total,...(id==='c7'?{deletedAt:'yes'}:{})});
 assert.equal(vm.runInContext('calculationTeam(state.requests[0])',ui),'','Old wrong team ignored');
 assert.equal(vm.runInContext("calculationTeam({event:'draft:bars',team:'ak-bars'})",ui),'bars');
 assert.equal(vm.runInContext("eventMatchesFilter(calculationTeam(state.requests[0]),'other')",ui),true);
 const now=Date.parse('2026-10-04T17:00:00Z');ui.now=now;
 const result=vm.runInContext('spentSummaryData(now)',ui);
 assert.equal(result.total,6850,'Three standards once, plus approved past calculations');
 assert.equal(result.events.length,4);
 assert.equal(result.events.find(g=>g.team==='other').total,750);
 assert.equal(result.events.find(g=>g.team==='ak-bars').total,1100);
 assert.equal(vm.runInContext("elapsedEvent({date:'2026-10-04T19:59'},now)",ui),true,'Moscow date');
 assert.equal(vm.runInContext("elapsedEvent({date:'2026-10-04T20:01'},now)",ui),false,'Not yet started');
 assert.equal(vm.runInContext("elapsedEvent({date:'2026-10-04'},now)",ui),false,'Unknown time waits until day end');
 for(const role of ['owner','coordinator','executive']){state.user.role=role;assert.equal(vm.runInContext('canSeeSpentSummary()',ui),true)}
 for(const role of ['employee','contractor_manager','performer']){state.user.role=role;assert.equal(vm.runInContext('canSeeSpentSummary()',ui),false)}
 state.user={organization:'contractor',role:'owner'};assert.equal(vm.runInContext('canSeeSpentSummary()',ui),false);
 console.log('PASS: legacy event/team filter, elapsed events in Moscow, approved-only totals, no deleted/future/unresolved calculations, standard cost once per match, all three teams and other events, summary roles.');
})().catch(e=>{console.error(e);process.exitCode=1});
