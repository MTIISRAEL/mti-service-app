var WORKER_EXEC_URL = 'https://script.google.com/macros/s/AKfycbxHOz998TfgtRqa8lI6zivPZChEtlCs12g_fsuAa1nMpQ-tAAGn8jMNlSuniK66DIL0/exec';

/* ===================== הגדרות: מהגיליון ל-Firestore (ומהאפליקציה לגיליון) ===================== */

/** לשוניות הגדרות / התאמה / מחירון בגיליון הן המקור. מה שמנהל שינה באפליקציה (מיילים לסיכום) נכתב קודם לגיליון. */
function syncConfig_() {
  var props = PropertiesService.getScriptProperties();
  var lastPushed = JSON.parse(props.getProperty('CFG_PUSHED') || '{}');
  var fsSet = fsGet_('config/settings') || {};
  // שינויים שנעשו באפליקציה → לגיליון
  var back = 0;
  Object.keys(fsSet).forEach(function (k) {
    if (k === '_row' || k === 'id' || k === '_ts' || SECRET_KEYS[k] || k === 'wa_ok' || k === 'sheet_url' || k === 'worker_url') return;
    if (lastPushed.hasOwnProperty(k) && String(fsSet[k]) !== String(lastPushed[k])) { setSetting_(k, fsSet[k]); back++; }
  });
  W.settings = null; W.sheet = {};
  var raw = {}; sheetRows_('settings').forEach(function (r) { raw[r.key] = r.value; });
  var pub = {};
  Object.keys(raw).forEach(function (k) { if (!SECRET_KEYS[k]) pub[k] = String(raw[k]); });
  pub.wa_ok = raw.wa_endpoint && raw.wa_key ? 'כן' : 'לא';
  pub.sheet_url = ss_().getUrl();
  pub.worker_url = WORKER_EXEC_URL;   // כתובת הפריסה הקבועה (getService מחזיר בטריגר כתובת אחרת)
  var match = sheetRows_('match').map(function (m) { return { userId: m.userId, product: m.product, callType: m.callType, level: m.level }; });
  var prices = sheetRows_('prices').map(function (m) { return { userId: m.userId, product: m.product, callType: m.callType, price: String(m.price) }; });
  var h = hash_(JSON.stringify([pub, match, prices]));
  if (h === props.getProperty('CFG_HASH') && !back) return { same: true };
  fsCommit_([
    { path: 'config/settings', data: pub },
    { path: 'config/match', data: { rows: match } },
    { path: 'config/prices', data: { rows: prices } }
  ]);
  props.setProperty('CFG_HASH', h);
  props.setProperty('CFG_PUSHED', JSON.stringify(pub));
  return { pushed: true, back: back };
}

/* ===================== העברת הנתונים מהגיליון ל-Firestore ===================== */

/**
 * הרצה מהעורך. מעתיק את כל הנתונים מהגיליון של המערכת הנוכחית ל-Firestore.
 * בטוח להריץ שוב: דורס לפי מזהה. wipe=true מוחק קודם קריאות/ביקורים/לקוחות/יומן שינויים שנוצרו בבדיקות.
 */
function migrateAll(wipe) {
  var t0 = Date.now(), out = {};
  W.sheet = {}; resetCache_();
  if (wipe === true) out.wiped = wipeData_();
  var w = [];
  // משתמשים + גישה לפי מייל
  var users = sheetRows_('users');
  users.forEach(function (u) {
    var d = pick_(u, ['id', 'name', 'role', 'kind', 'regions', 'active', 'email', 'lastSeen', 'calId', 'phone']);
    d.email = String(d.email || '').trim().toLowerCase();
    d.calShare = '';
    w.push({ path: 'users/' + u.id, data: d });
    if (d.email) w.push({ path: 'access/' + d.email, data: { uid: u.id, role: u.role, kind: u.kind || '', active: u.active === 'לא' ? 'לא' : 'כן' } });
  });
  // מיילים נוספים לאותו משתמש (מאפיין ACCESS_ALIASES: "mail:uid,mail:uid")
  String(prop_('ACCESS_ALIASES') || '').split(',').forEach(function (pair) {
    var p = pair.split(':'), em = String(p[0] || '').trim().toLowerCase(), u = users.filter(function (x) { return x.id === String(p[1] || '').trim(); })[0];
    if (em && u) w.push({ path: 'access/' + em, data: { uid: u.id, role: u.role, kind: u.kind || '', active: u.active === 'לא' ? 'לא' : 'כן' } });
  });
  out.users = users.length;
  // לקוחות
  var custs = {}; sheetRows_('customers').forEach(function (c) { custs[c.id] = c; w.push({ path: 'customers/' + c.id, data: strip_(c) }); });
  out.customers = Object.keys(custs).length;
  // קריאות (עם פרטי הלקוח בפנים)
  var calls = sheetRows_('calls');
  calls.forEach(function (c) {
    var d = strip_(c);
    d.archived = false;
    d.cust = custSnap_(custs[c.customerId]);
    w.push({ path: 'calls/' + c.id, data: d });
  });
  out.calls = calls.length;
  // ביקורים
  var visits = sheetRows_('visits');
  visits.forEach(function (v) { var d = strip_(v); d.archived = false; w.push({ path: 'visits/' + v.id, data: d }); });
  out.visits = visits.length;
  // יומן שינויים
  var logs = sheetRows_('log');
  logs.forEach(function (l, i) { w.push({ path: 'log/M' + ('00000' + i).slice(-6), data: strip_(l) }); });
  out.log = logs.length;
  // התראות
  sheetRows_('alerts').forEach(function (a, i) { w.push({ path: 'alerts/M' + ('00000' + i).slice(-6), data: strip_(a) }); });
  // מונה
  var next = 0; calls.forEach(function (c) { next = Math.max(next, Number(c.id) || 0); });
  var sNext = Number((sheetRows_('settings').filter(function (r) { return r.key === 'next_call_id'; })[0] || {}).value || 1001);
  w.push({ path: 'meta/counter', data: { next: Math.max(next + 1, sNext) } });
  fsCommit_(w);
  out.writes = w.length;
  // היסטוריית היומן הישן לפי חודש
  out.oldcal = migrateOldcal_();
  // הגדרות
  PropertiesService.getScriptProperties().deleteProperty('CFG_HASH');
  PropertiesService.getScriptProperties().deleteProperty('CFG_PUSHED');
  out.cfg = syncConfig_();
  out.sec = Math.round((Date.now() - t0) / 1000);
  Logger.log(JSON.stringify(out));
  return out;
}

/** תמונות וחתימות מ-Drive → מסמכי files (אותו מזהה). להריץ אחרי migrateAll. */
function migrateFiles() {
  var visits = sheetRows_('visits'), calls = {}, n = 0, skipped = 0, w = [];
  sheetRows_('calls').forEach(function (c) { calls[c.id] = c; });
  visits.forEach(function (v) {
    list_(v.photos).concat(v.signature ? [v.signature] : []).forEach(function (fid) {
      if (fsGet_('files/' + fid)) { skipped++; return; }
      try {
        var b = DriveApp.getFileById(fid).getBlob(), data = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
        if (data.length > 1000000) { skipped++; return; }
        w.push({ path: 'files/' + fid, data: { data: data, name: b.getName(), callId: String(v.callId), userId: v.userId, assignedUser: (calls[v.callId] || {}).assignedUser || '', at: v.at } });
        n++;
        if (w.length >= 8) { fsCommit_(w); w = []; }
      } catch (e) { Logger.log('קובץ ' + fid + ': ' + e); }
    });
  });
  if (w.length) fsCommit_(w);
  Logger.log('הועברו ' + n + ' קבצים, דולגו ' + skipped);
  return { moved: n, skipped: skipped };
}

function migrateOldcal_() {
  var rows = sheetRows_('oldcal'), buckets = {};
  rows.forEach(function (e) {
    var o = { key: e.key, start: e.start, end: e.end, title: e.title, location: e.location, description: String(e.description || '').slice(0, 600), color: e.color };
    var sp = oldSpan_(e), k = sp.start.slice(0, 7), k2 = sp.last.slice(0, 7);
    (buckets[k] = buckets[k] || []).push(o);
    if (k2 !== k) (buckets[k2] = buckets[k2] || []).push(o);
  });
  var w = Object.keys(buckets).map(function (m) { return { path: 'oldcal/' + m, data: { events: buckets[m] } }; });
  w.push({ path: 'meta/oldcal', data: { count: rows.length } });
  for (var i = 0; i < w.length; i += 20) fsCommit_(w.slice(i, i + 20));
  return { events: rows.length, months: Object.keys(buckets).length };
}

function wipeData_() {
  var n = 0;
  ['calls', 'visits', 'customers', 'log', 'files', 'alerts'].forEach(function (col) {
    var docs = fsList_(col);
    var w = docs.map(function (d) { return { path: col + '/' + d._row, del: true }; });
    if (w.length) fsCommit_(w);
    n += w.length;
  });
  return n;
}

function strip_(o) { var d = {}; for (var k in o) if (k !== '_row') d[k] = o[k] === undefined || o[k] === null ? '' : String(o[k]); return d; }
function pick_(o, keys) { var d = {}; keys.forEach(function (k) { d[k] = o[k] === undefined || o[k] === null ? '' : String(o[k]); }); return d; }

/* ===================== ארכיון וגיבוי ===================== */

/** קריאות שנסגרו לפני יותר מ-120 יום יוצאות מהטעינה הקבועה באפליקציה (נשארות במסד) */
function archiveOld_() {
  var cut = addDays_(today_(), -120), w = [];
  read_('calls').forEach(function (c) {
    if (c.archived === true) return;
    if ((c.status === 'נסגרה' || c.status === 'בוטלה') && c.closedAt && String(c.closedAt).slice(0, 10) < cut) w.push({ path: 'calls/' + c._row, data: { archived: true }, merge: true });
  });
  read_('visits').forEach(function (v) {
    if (v.archived === true || String(v.at).slice(0, 10) >= cut) return;
    var billed = !(Number(v.amount) > 0) || (v.invoiceAt && v.receiptAt);
    if (billed) w.push({ path: 'visits/' + v._row, data: { archived: true }, merge: true });
  });
  if (w.length) fsCommit_(w);
  return w.length;
}

/** גיבוי: כותב את כל הנתונים מ-Firestore ללשוניות הגיליון (פעם בלילה, אחרי יום המעבר) */
function mirrorToSheet() {
  resetCache_();
  var ss = ss_();
  ['users', 'customers', 'calls', 'visits'].forEach(function (key) {
    var rows = read_(key), cols = SCHEMA[key].cols, sh = ss.getSheetByName(SCHEMA[key].tab);
    if (key === 'calls') rows = rows.slice().sort(function (a, b) { return Number(a.id) - Number(b.id); });
    var vals = rows.map(function (o) { return cols.map(function (c) { var v = o[c[0]]; return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }); });
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).clearContent();
    if (vals.length) {
      if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
      sh.getRange(2, 1, vals.length, cols.length).setNumberFormat('@').setValues(vals);
    }
  });
  // יומן שינויים: רק מה שנוסף מאז הגיבוי הקודם
  var props = PropertiesService.getScriptProperties(), last = props.getProperty('MIRROR_LOG_AT') || '0000';
  var logs = fsQuery_('log', [['at', 'GREATER_THAN', last]], ['at']);
  if (logs.length) {
    var sh = ss.getSheetByName(SCHEMA.log.tab), cols = SCHEMA.log.cols;
    var vals = logs.map(function (l) { return cols.map(function (c) { return String(l[c[0]] || ''); }); });
    sh.getRange(sh.getLastRow() + 1, 1, vals.length, cols.length).setNumberFormat('@').setValues(vals);
    props.setProperty('MIRROR_LOG_AT', logs[logs.length - 1].at);
  }
  return true;
}

/* ===================== "דחיפה" מהאפליקציה ===================== */

/** האפליקציה שולחת POST אחרי כל שמירה, כדי שהיומנים יתעדכנו מיד (ולא רק כל 5 דקות) */
function doPost(e) {
  try { var r = gcalTick(); return ContentService.createTextOutput(r && r.queued ? 'queued' : 'ok'); }
  catch (x) { Logger.log('kick: ' + x); return ContentService.createTextOutput('err'); }
}
function doGet() { return ContentService.createTextOutput('MTI שירות – מנוע ברקע'); }

/* ===================== התקנה ===================== */

/** הרצה ראשונה מהעורך (אחרי שמגדירים SHEET_ID): בודק גישה ל-Firestore ולגיליון */
function checkWorker() {
  var r = { sheet: ss_().getName(), live: live_(), shared: prop_('GCAL_SHARED_ID') || '', users: fsList_('users').length };
  Logger.log(JSON.stringify(r));
  return r;
}

/** ביום המעבר: מפעיל את כל הטריגרים של המנוע */
function installWorkerTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('gcalTick').timeBased().everyMinutes(5).create();
  var cal = sharedCal_();
  if (cal) ScriptApp.newTrigger('gcalTick').forUserCalendar(cal.getId()).onEventUpdated().create();
  ScriptApp.newTrigger('gcalNightly').timeBased().atHour(3).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('alertsTick').timeBased().everyMinutes(10).create();
  var hour = Number(settings_().summary_hour || 17);
  ScriptApp.newTrigger('dailySummary').timeBased().atHour(hour).nearMinute(0).everyDays(1).inTimezone(TZ).create();
  PropertiesService.getScriptProperties().deleteProperty('GCAL_SYNC_TOKEN');
  PropertiesService.getScriptProperties().deleteProperty('FS_LAST_TS');
  var r = gcalTick();
  Logger.log('מותקן · ' + JSON.stringify(r));
  return r;
}

function removeWorkerTriggers() { ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); }

/**
 * יום המעבר: מחבר את 'יומן שירות ספא', מפעיל מיילים / יומנים אישיים / וואטסאפ / גיבוי לגיליון, ומתקין את הטריגרים.
 * להריץ אחרי migrateAll האחרון ואחרי שהמערכת הישנה נסגרה.
 */
function goLive() {
  var cal = CalendarApp.getCalendarsByName('יומן שירות ספא')[0];
  if (!cal) throw new Error('לא נמצא יומן בשם יומן שירות ספא');
  var p = PropertiesService.getScriptProperties();
  p.setProperty('GCAL_SHARED_ID', cal.getId());
  p.setProperty('WORKER_LIVE', 'yes');
  p.setProperty('MIRROR_ON', 'yes');
  W.settings = null;
  var r = installWorkerTriggers();
  Logger.log('פעיל · ' + JSON.stringify(r));
  return r;
}
