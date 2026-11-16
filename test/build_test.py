import re, json, os
root='/home/claude/mti-web'
s=open(root+'/index.html',encoding='utf-8').read()
s=re.sub(r'<script type="module">.*?</script>', '<script src="test/mockfb.js"></script><script>start();</script>', s, flags=re.S)
s=s.replace('<link rel="manifest" href="manifest.json">','')
open(root+'/test.html','w',encoding='utf-8').write(s)
# seed
users=[('meir','מאיר','admin','','','m@t.co'),('kobi','קובי','manager','','','k@t.co'),('rachli','רחלי','office','','','r@t.co'),('limor','לימור','billing','','','l@t.co'),
 ('ali','עלי','tech','פנימי','','a@t.co'),('jaber',"ג'אבר",'tech','פנימי','','j@t.co'),('tal','טל','tech','חיצוני','מרכז,ירושלים והסביבה,שפלה,דרום,שרון','t@t.co'),('liran','לירן','tech','חיצוני','שרון,חיפה והקריות,צפון','li@t.co'),('ronen','רונן','tech','חיצוני','שרון,חיפה והקריות,צפון','ro@t.co')]
seed={}
for u in users:
  seed['users/'+u[0]]={'id':u[0],'name':u[1],'role':u[2],'kind':u[3],'regions':u[4],'active':'כן','email':u[5],'lastSeen':'','calId':'','phone':''}
  seed['access/'+u[5]]={'uid':u[0],'role':u[2],'kind':u[3],'active':'כן'}
core=open(root+'/core.js',encoding='utf-8').read()
import subprocess
js=subprocess.run(['node','-e',"""
const vm=require('vm');const ctx={};vm.createContext(ctx);vm.runInContext(require('fs').readFileSync('%s/core.js','utf8')+';this.out={s:DEFAULT_SETTINGS};',ctx);
console.log(JSON.stringify(ctx.out));"""%root],capture_output=True,text=True).stdout
d=json.loads(js)
seed['config/settings']={r[0]:r[1] for r in d['s'] if r[0] not in ('wa_key','wa_endpoint','files_folder','next_call_id')}
seed['config/settings']['wa_ok']='לא'
M=[['jaber','ספא','התקנה','ראשי'],['jaber','ספא','תקלה','ראשי'],['jaber','ספא','חלק','ראשי'],['jaber','בריכת זרמים','התקנה','ראשי'],['jaber','בריכת זרמים','תקלה','ראשי'],['jaber','בריכת זרמים','חלק','ראשי'],['ali','ספא','התקנה','מועדף'],['ali','ספא','תקלה','פשוטה בלבד'],['ali','ספא','חלק','פשוטה בלבד'],['tal','ספא','התקנה','ראשי'],['liran','ספא','התקנה','ראשי'],['liran','ספא','תקלה','בעומס'],['liran','ספא','חלק','בעומס'],['ronen','ספא','התקנה','חירום'],['ronen','ספא','תקלה','חירום'],['ronen','ספא','חלק','חירום'],['ronen','סאונה','התקנה','ראשי'],['ronen','סאונה','תקלה','ראשי'],['ronen','סאונה','חלק','ראשי']]
seed['config/match']={'rows':[dict(userId=m[0],product=m[1],callType=m[2],level=m[3]) for m in M]}
seed['config/prices']={'rows':[dict(userId='liran',product='ספא',callType='התקנה',price='1500'),dict(userId='tal',product='ספא',callType='התקנה',price='2000'),dict(userId='ronen',product='סאונה',callType='התקנה',price='2000')]}
seed['meta/counter']={'next':1100}
seed['customers/C1']={'id':'C1','name':'משפחת לוי','phone':'0501112222','address':'הזית 3','city':'רעננה','region':'שרון','type':'פרטי','createdAt':'2026-11-01 10:00'}
seed['calls/1090']={'id':'1090','createdAt':'2026-11-10 09:00','createdBy':'rachli','customerId':'C1','product':'ספא','callType':'תקלה','customerType':'פרטי','region':'שרון','urgent':'לא','urgentReason':'','warranty':'כן','simple':'לא','description':'לא מחמם','status':'נפתחה','suggestedUser':'jaber','suggestedDate':'','suggestReason':'','assignedUser':'','updatedAt':'2026-11-10 09:00','archived':False,'cust':{'name':'משפחת לוי','phone':'0501112222','address':'הזית 3','city':'רעננה','region':'שרון','type':'פרטי'}}
seed['oldcal/2026-11']={'events':[{'key':'k1','start':'2026-11-17 08:00','end':'2026-11-17 10:00','title':'ישן: בדיקה','location':'חולון','description':'x','color':'#039be5'}]}
json.dump(seed,open(root+'/test/seed.json','w'),ensure_ascii=False)
print('ok', len(seed))
