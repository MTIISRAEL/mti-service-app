// בדיקת המנוע ברקע: העברה מהגיליון, שינויים מהאפליקציה → יומן, הזזה ביומן → Firestore
var fs=require('fs'),vm=require('vm');
const pre=fs.readFileSync('/home/claude/mti-service/test/e2e.test.js','utf8').split('\n').slice(0,34).join('\n');
eval(pre.replace(/^(const|let) /gm,'var ').replace(/;(const|let) /g,';var ').replace("__dirname+'/../Code.gs'","'/home/claude/mti-service/Code.gs'"));
// --- המערכת הישנה: נתונים בגיליון ---
G.LockService.getScriptLock=()=>({waitLock(){},tryLock:()=>true,releaseLock(){}});
reset(); r=call(T['רחלי'],'createCall',{product:'ספא',callType:'התקנה',warranty:'כן',customer:{name:'לוי',phone:'0502223333',address:'הזית 1',city:'נתניה',region:'שרון',type:'פרטי'}});
const c1=r.data.id;
reset(); r=call(T['רחלי'],'assign',{id:c1,userId:'ali',date:'2026-10-28',time:'10:00',endTime:'14:00',confirmed:true}); ok(r.ok,'שיבוץ במערכת הישנה');
reset(); r=call(T['רחלי'],'createCall',{product:'ספא + בריכת זרמים',callType:'תקלה',warranty:'כן',customer:{name:'כהן',phone:'0509998888',city:'חיפה',region:'חיפה והקריות',type:'פרטי'}});
const c2=r.data.id;
SS.getSheetByName('היסטוריית יומן').rows.push(['k1','2026-09-03 08:00','2026-09-03 10:00','ישן','חולון','תיאור','יומן','#039be5']);

SS.sheets.forEach(sh=>{sh.getMaxColumns=()=>99;const g=sh.getRange.bind(sh);sh.getRange=(r,c,nr,nc)=>{const x=g(r,c,nr,nc);x.clearContent=()=>{for(let i=0;i<nr;i++)sh.rows[r-1+i]=[];return x};x.setValue=v=>{x.setValues([[v]])};return x};});
// --- Firestore מדומה (REST) ---
const FSD={}; let tsN=0;
const nextTs=()=>'2026-10-25T07:00:00.'+String(++tsN).padStart(6,'0')+'Z';
const BASE='https://firestore.googleapis.com/v1/projects/mti-service-bd77f/databases/(default)/documents';
const pathOf=name=>name.split('/documents/')[1];
function decV(v){ if('stringValue'in v)return v.stringValue; if('integerValue'in v)return Number(v.integerValue); if('booleanValue'in v)return v.booleanValue; if('timestampValue'in v)return v.timestampValue; if('mapValue'in v){const o={};for(const k in (v.mapValue.fields||{}))o[k]=decV(v.mapValue.fields[k]);return o} if('arrayValue'in v)return (v.arrayValue.values||[]).map(decV); return null;}
function fsResp(code,obj){return{getResponseCode:()=>code,getContentText:()=>JSON.stringify(obj)}}
const fetchLog=[];
const UrlFetchApp={fetch(url,opt){
  fetchLog.push(url);
  if(!url.startsWith(BASE)) return fsResp(200,{});
  const method=(opt.method||'get').toLowerCase(), body=opt.payload?JSON.parse(opt.payload):null;
  if(url===BASE+':commit'){
    body.writes.forEach(w=>{
      if(w.delete){delete FSD[pathOf(w.delete)];return}
      const p=pathOf(w.update.name); let cur=FSD[p];
      if(w.updateMask&&cur){cur={fields:Object.assign({},cur.fields)};w.updateMask.fieldPaths.forEach(k=>{cur.fields[k]=w.update.fields[k]})}
      else cur={fields:Object.assign({},w.update.fields)};
      (w.updateTransforms||[]).forEach(t=>{cur.fields[t.fieldPath]={timestampValue:nextTs()}});
      FSD[p]=cur;
    });
    return fsResp(200,{});
  }
  if(url===BASE+':runQuery'){
    const q=body.structuredQuery, col=q.from[0].collectionId;
    const filters=!q.where?[]:q.where.fieldFilter?[q.where.fieldFilter]:q.where.compositeFilter.filters.map(f=>f.fieldFilter);
    let docs=Object.keys(FSD).filter(p=>p.split('/')[0]===col&&p.split('/').length===2).filter(p=>filters.every(f=>{
      const fv=FSD[p].fields[f.field.fieldPath]; if(!fv) return false; const a=decV(fv), b=decV(f.value);
      if(f.op==='EQUAL')return a===b; if(f.op==='GREATER_THAN')return a>b; if(f.op==='GREATER_THAN_OR_EQUAL')return a>=b; if(f.op==='IN')return b.includes(a); throw 'op '+f.op}));
    if(q.orderBy){const k=q.orderBy[0].field.fieldPath,d=q.orderBy[0].direction==='DESCENDING'?-1:1;docs=docs.filter(p=>FSD[p].fields[k]);docs.sort((x,y)=>{const a=decV(FSD[x].fields[k]),b=decV(FSD[y].fields[k]);return (a<b?-1:a>b?1:0)*d})}
    if(q.limit)docs=docs.slice(0,q.limit);
    return fsResp(200,docs.map(p=>({document:{name:'projects/x/databases/(default)/documents/'+p,fields:FSD[p].fields}})));
  }
  const rest=url.slice(BASE.length+1).split('?')[0];
  if(rest.split('/').length===2){const d=FSD[rest];return d?fsResp(200,{name:'projects/x/databases/(default)/documents/'+rest,fields:d.fields}):fsResp(404,{})}
  const docs=Object.keys(FSD).filter(p=>p.split('/')[0]===rest&&p.split('/').length===2).map(p=>({name:'projects/x/databases/(default)/documents/'+p,fields:FSD[p].fields}));
  return fsResp(200,{documents:docs});
}};
const get=p=>{const d=FSD[p];if(!d)return null;const o={};for(const k in d.fields)o[k]=decV(d.fields[k]);return o};
// עדכון "מהאפליקציה": כותב ישירות למסד עם _ts חדש
const appWrite=(p,patch)=>{const cur=FSD[p]||{fields:{}};const f=Object.assign({},cur.fields);for(const k in patch)f[k]=typeof patch[k]==='boolean'?{booleanValue:patch[k]}:{stringValue:String(patch[k])};f._ts={timestampValue:nextTs()};FSD[p]={fields:f}};

// --- היומן המשותף המדומה ---
const SH={evs:{},k:0};
const day=d=>new Date(d+'T00:00:00+02:00');
function mkEv(id){return{getId:()=>id,getTitle:()=>SH.evs[id].title,setTitle:t=>{SH.evs[id].title=t},getDescription:()=>SH.evs[id].desc,setDescription:t=>{SH.evs[id].desc=t},getLocation:()=>SH.evs[id].loc,setLocation:t=>{SH.evs[id].loc=t},getColor:()=>SH.evs[id].color,setColor:c=>{SH.evs[id].color=c},isAllDayEvent:()=>SH.evs[id].allDay,getAllDayStartDate:()=>SH.evs[id].start,getStartTime:()=>SH.evs[id].start,getEndTime:()=>SH.evs[id].end,setTime:(s,e)=>{Object.assign(SH.evs[id],{start:s,end:e,allDay:false})},setAllDayDate:d=>{},deleteEvent:()=>{delete SH.evs[id]}}}
const shared={getId:()=>'shared',getName:()=>'יומן שירות ספא',getEvents:(f,t)=>Object.keys(SH.evs).filter(id=>SH.evs[id].start>=f&&SH.evs[id].start<t).map(mkEv),getEventById:id=>SH.evs[id]?mkEv(id):null,
 createEvent:(title,s,e,o)=>{const id='ev'+(++SH.k)+'@google.com';SH.evs[id]={title,start:s,end:e,allDay:false,desc:o.description,loc:o.location,color:''};return mkEv(id)},
 createAllDayEvent:(title,d,o)=>{const id='ev'+(++SH.k)+'@google.com';SH.evs[id]={title,start:day('2026-10-28'),end:day('2026-10-29'),allDay:true,desc:o.description,loc:o.location,color:''};return mkEv(id)}};

// --- המנוע ---
const wprops={SHEET_ID:'SS1',GCAL_SHARED_ID:'shared',WORKER_LIVE:'yes'};
const W=Object.assign({},G,{UrlFetchApp,
  PropertiesService:{getScriptProperties(){return{getProperty:k=>wprops[k]??null,setProperty:(k,v)=>{wprops[k]=v},deleteProperty:k=>{delete wprops[k]},getProperties:()=>({...wprops})}}},
  ScriptApp:{getOAuthToken:()=>'tok',getService:()=>({getUrl:()=>'https://worker'}),getProjectTriggers:()=>[],newTrigger(){const t={timeBased:()=>t,atHour:()=>t,nearMinute:()=>t,everyDays:()=>t,everyMinutes:()=>t,inTimezone:()=>t,forUserCalendar:()=>t,onEventUpdated:()=>t,create:()=>t};return t},deleteTrigger(){}},
  CalendarApp:Object.assign({},G.CalendarApp,{getCalendarById:id=>id==='shared'?shared:G.CalendarApp.getCalendarById(id)}),
  Logger:{log:m=>console.log('   log:',m)}});
Object.assign(W.Utilities,{sleep(){}});
vm.createContext(W);
['/home/claude/mti-web/core.js','/home/claude/mti-web/worker/worker.gs','/home/claude/mti-web/worker/gcal.gs','/home/claude/mti-web/worker/admin.gs'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),W,{filename:f}));

const m=W.migrateAll();
ok(m.calls===2&&m.customers===2&&m.users===9,'העברה: '+JSON.stringify(m));
ok(get('access/mti.kobi@gmail.com')&&get('access/mti.kobi@gmail.com').uid==='kobi','גישה לפי מייל (באותיות קטנות)');
ok(get('calls/'+c1).cust.name==='לוי'&&get('calls/'+c1).archived===false,'פרטי הלקוח בתוך הקריאה');
ok(get('meta/counter').next===Number(c2)+1,'מונה הקריאות ממשיך');
ok(get('oldcal/2026-09').events.length===1,'היסטוריית היומן לפי חודש');
const cs=get('config/settings');ok(cs&&!('wa_key'in cs)&&cs.wa_ok==='לא'&&cs.worker_url==='https://worker','הגדרות בלי סודות');
ok(get('config/match').rows.length>5,'טבלת התאמה');

// התקנה: מתחיל מהמצב הנוכחי
let t=W.installWorkerTriggers();
ok(t.changed===0,'התקנה: לא מעבד את הכל מחדש');
// שינוי באפליקציה: שיבוץ קריאה 2
appWrite('calls/'+c2,{assignedUser:'jaber',date:'2026-10-29',time:'09:00',endTime:'11:00',status:'תואם מועד',updatedAt:'2026-10-25 09:00'});
t=W.gcalTick(); ok(t.changed>=1,'השינוי זוהה: '+JSON.stringify(t));
const e2=get('calls/'+c2).gEventId; ok(e2&&SH.evs[e2],'נוצר אירוע ביומן המשותף');
ok(SH.evs[e2]&&SH.evs[e2].title==="חיפה · כהן · קריאת שירות (ג'אבר)"&&SH.evs[e2].color==='11','כותרת וצבע: '+(SH.evs[e2]||{}).title);
ok(get('calls/'+c2).calEventId,'נוצר אירוע ביומן האישי של הטכנאי');
const ce=get('calls/'+c2).calEventId;
t=W.gcalTick(); ok(t.changed>=1,'סיבוב שני מעבד את הכתיבה של עצמו');
t=W.gcalTick(); ok(t.changed===0,'סיבוב שלישי: שקט');
ok(get('calls/'+c2).calEventId===ce,'האירוע האישי לא נוצר מחדש בלי שינוי');
// הזזה ביומן גוגל (סריקה מלאה, בלי Calendar API)
SH.evs[e2].start=new Date('2026-10-30T12:00:00+02:00');SH.evs[e2].end=new Date('2026-10-30T13:30:00+02:00');
const st=W.gcalNightly(); ok(st.pulled===1,'הזזה ביומן נקלטה: '+JSON.stringify(st));
const c2d=get('calls/'+c2); ok(c2d.date==='2026-10-30'&&c2d.time==='12:00'&&c2d.endTime==='13:30','הקריאה ב-Firestore זזה');
ok(Object.keys(FSD).some(p=>p.startsWith('log/')&&get(p).action==='הוזזה ביומן גוגל'),'נרשם ביומן השינויים');
// לקוח שהשתנה → cust בקריאות
W.resetCache_(); W.update_('customers',get('calls/'+c2).customerId,{name:'כהן-לוי'}); ok(get('calls/'+c2).cust.name==='כהן-לוי','עדכון לקוח מעדכן את הקריאות שלו');
// מייל חדש לטכנאי → שיתוף יומן
appWrite('users/tal',{calShare:'pending',email:'tal@x.com'}); W.Calendar={Acl:{insert:(a,id)=>{W._shared=[a.scope.value,id]}},Events:{list:()=>({items:[],nextSyncToken:'t1'})}};
W.gcalTick(); ok(W._shared&&W._shared[0]==='tal@x.com'&&get('users/tal').calShare==='done','יומן אישי שותף לטכנאי');
// שינוי הגדרה באפליקציה חוזר לגיליון
appWrite('config/settings',Object.assign({},get('config/settings'),{summary_emails:'new@x.com'}));
W.gcalTick(); W.W.sheet={}; ok(W.settings_().summary_emails==='new@x.com'||W.sheetRows_('settings').find(r=>r.key==='summary_emails').value==='new@x.com','מייל סיכום שנשמר באפליקציה נכתב לגיליון');
// גיבוי לגיליון
W.mirrorToSheet(); const shRows=SS.getSheetByName('קריאות').rows; ok(shRows.length===3&&shRows.some(r=>r[0]===c2&&r[19]==='2026-10-30'),'גיבוי לגיליון');
// סיכום יומי
mails.length=0; W.dailySummary(); ok(mails.length>=1&&/סיכום שירות/.test(mails[0].subject),'סיכום יומי נשלח');
// משיכה מהירה (Calendar API עם syncToken): רחלי גררה ביומן
SH.evs[e2].start=new Date('2026-11-02T08:00:00+02:00');SH.evs[e2].end=new Date('2026-11-02T09:00:00+02:00');
W.Calendar.Events.list=(id,args)=>args.syncToken?{items:[{id:e2.split('@')[0],iCalUID:e2,status:'confirmed',start:{dateTime:'2026-11-02T08:00:00+02:00'},end:{dateTime:'2026-11-02T09:00:00+02:00'}}],nextSyncToken:'t2'}:{items:[],nextSyncToken:'t1'};
t=W.gcalTick(); ok(t.pull.pulled===1&&get('calls/'+c2).date==='2026-11-02'&&get('calls/'+c2).time==='08:00','משיכה מהירה מגוגל: '+JSON.stringify(t.pull));
W.Calendar.Events.list=(id,args)=>args.syncToken?{items:[{id:e2.split('@')[0],iCalUID:e2,status:'cancelled'}],nextSyncToken:'t3'}:{items:[],nextSyncToken:'t1'};
t=W.gcalTick(); ok(t.pull.removed===1&&get('calls/'+c2).date===''&&get('calls/'+c2).status==='לתיאום מחדש','מחיקה ביומן ← חוזר לתיאום');
console.log(fails?'נכשלו '+fails:'הכל עבר');
