/**
 * MTI שירות – מנוע ברקע (Apps Script) למערכת ב-Firebase.
 * הלוגיקה המשותפת נמצאת ב-core.gs (אותו קובץ כמו core.js באתר).
 * כאן: גישה ל-Firestore, סנכרון יומנים, סיכום יומי, וואטסאפ, הגדרות מהגיליון, גיבוי לגיליון, והעברת הנתונים.
 *
 * מאפייני סקריפט:
 *   SHEET_ID        – הגיליון (הגדרות, התאמה, מחירון, והגיבוי)
 *   WORKER_LIVE     – 'yes' אחרי יום המעבר. לפני כן: בלי יומנים אישיים, בלי מיילים ובלי וואטסאפ.
 *   GCAL_SHARED_ID  – 'יומן שירות ספא' (בבדיקות: יומן בדיקה)
 *   MIRROR_ON       – 'yes' אחרי יום המעבר: גיבוי הנתונים ללשוניות הגיליון
 */
var FS_PROJECT = 'mti-service-bd77f';
var FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT + '/databases/(default)/documents';
var SECRET_KEYS = { wa_key: 1, wa_endpoint: 1, files_folder: 1, next_call_id: 1 };

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function live_() { return prop_('WORKER_LIVE') === 'yes'; }

/* ===================== Firestore REST ===================== */

function fsFetch_(method, url, body) {
  var opt = { method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': FS_PROJECT } };
  if (body) opt.payload = JSON.stringify(body);
  for (var attempt = 0; attempt < 3; attempt++) {
    var r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode();
    if (code === 200) return JSON.parse(r.getContentText() || '{}');
    if (code === 404 && method === 'get') return null;
    if (code !== 429 && code < 500) throw new Error('Firestore ' + code + ': ' + r.getContentText().slice(0, 400));
    Utilities.sleep(800 * (attempt + 1));
  }
  throw new Error('Firestore לא זמין');
}

function enc_(v) {
  if (v === null || v === undefined) return { stringValue: '' };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Math.floor(v) === v ? { integerValue: String(v) } : { doubleValue: v };
  if (Object.prototype.toString.call(v) === '[object Array]') return { arrayValue: { values: v.map(enc_) } };
  if (typeof v === 'object' && v.__ts) return { timestampValue: v.__ts };
  if (typeof v === 'object') { var f = {}; for (var k in v) if (k !== '_row') f[k] = enc_(v[k]); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function dec_(v) {
  if (!v) return '';
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return '';
  if ('mapValue' in v) { var o = {}, f = v.mapValue.fields || {}; for (var k in f) o[k] = dec_(f[k]); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec_);
  return '';
}
function fromDoc_(d) {
  var o = {}, f = d.fields || {};
  for (var k in f) o[k] = dec_(f[k]);
  var id = d.name.split('/').pop();
  o._row = id; if (o.id === undefined || o.id === '') o.id = id;
  return o;
}
function encFields_(obj) { var f = {}; for (var k in obj) if (k !== '_row') f[k] = enc_(obj[k]); return f; }
function docName_(path) { return 'projects/' + FS_PROJECT + '/databases/(default)/documents/' + path; }

function fsGet_(path) { var d = fsFetch_('get', FS_BASE + '/' + path); return d && d.name ? fromDoc_(d) : null; }

function fsList_(col) {
  var out = [], tok = '';
  do {
    var r = fsFetch_('get', FS_BASE + '/' + col + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    (r.documents || []).forEach(function (d) { out.push(fromDoc_(d)); });
    tok = r.nextPageToken || '';
  } while (tok);
  return out;
}

/** filters: [[field, op, value]], op: EQUAL / GREATER_THAN / GREATER_THAN_OR_EQUAL / IN … */
function fsQuery_(col, filters, orderBy, limit) {
  var q = { from: [{ collectionId: col }] };
  var ff = (filters || []).map(function (f) {
    return { fieldFilter: { field: { fieldPath: f[0] }, op: f[1], value: f[1] === 'IN' ? { arrayValue: { values: f[2].map(enc_) } } : enc_(f[2]) } };
  });
  if (ff.length === 1) q.where = ff[0];
  else if (ff.length > 1) q.where = { compositeFilter: { op: 'AND', filters: ff } };
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy[0] }, direction: orderBy[1] || 'ASCENDING' }];
  if (limit) q.limit = limit;
  var r = fsFetch_('post', FS_BASE + ':runQuery', { structuredQuery: q });
  return (r || []).filter(function (x) { return x.document; }).map(function (x) { var o = fromDoc_(x.document); o._ts = (x.document.fields && x.document.fields._ts) ? x.document.fields._ts.timestampValue : ''; return o; });
}

/** writes: [{path, data, merge, del}] – עד 450 בכל בקשה */
function fsCommit_(writes) {
  for (var i = 0; i < writes.length; i += 450) {
    var body = { writes: writes.slice(i, i + 450).map(function (w) {
      if (w.del) return { delete: docName_(w.path) };
      var x = { update: { name: docName_(w.path), fields: encFields_(w.data) }, updateTransforms: [{ fieldPath: '_ts', setToServerValue: 'REQUEST_TIME' }] };
      if (w.merge) x.updateMask = { fieldPaths: Object.keys(w.data).filter(function (k) { return k !== '_row'; }) };
      return x;
    }) };
    fsFetch_('post', FS_BASE + ':commit', body);
  }
}

/* ===================== שכבת הנתונים ל-core ===================== */

var W = { cache: {}, full: {}, settings: null, sheet: {} };
var COL_KEYS = { users: 1, customers: 1, calls: 1, visits: 1 };

function resetCache_() { W.cache = {}; W.full = {}; }
function ss_() { return SpreadsheetApp.openById(prop_('SHEET_ID')); }

function sheetRows_(key) {
  if (W.sheet[key]) return W.sheet[key];
  var sh = ss_().getSheetByName(SCHEMA[key].tab), cols = SCHEMA[key].cols, n = sh.getLastRow(), out = [];
  if (n > 1) sh.getRange(2, 1, n - 1, cols.length).getValues().forEach(function (row, r) {
    var o = { _row: r + 2 }, empty = true;
    cols.forEach(function (c, i) { o[c[0]] = cellStr_(row[i]); if (o[c[0]] !== '') empty = false; });
    if (!empty) out.push(o);
  });
  W.sheet[key] = out;
  return out;
}
function cellStr_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (v.getFullYear() < 1901) return Utilities.formatDate(v, TZ, 'HH:mm');
    var hasTime = v.getHours() || v.getMinutes();
    return Utilities.formatDate(v, TZ, hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  return String(v);
}

function remember_(key, o) { (W.cache[key] = W.cache[key] || {})[String(o._row)] = o; return o; }

function read_(key) {
  if (key === 'match' || key === 'prices') return sheetRows_(key);
  if (key === 'oldcal') return [];
  if (key === 'alerts') return fsQuery_('alerts', [['at', 'GREATER_THAN_OR_EQUAL', today_()]]);
  if (key === 'log') return fsQuery_('log', [['at', 'GREATER_THAN_OR_EQUAL', today_()]]);
  if (!W.full[key]) {
    W.full[key] = fsList_(key);
    W.full[key].forEach(function (o) { remember_(key, o); });
    if (key === 'calls') W.full[key].sort(function (a, b) { return Number(a.id) - Number(b.id); });
  }
  return W.full[key];
}

function find_(key, id, field) {
  if (field && field !== 'id') { var rows = read_(key); for (var i = 0; i < rows.length; i++) if (String(rows[i][field]) === String(id)) return rows[i]; return null; }
  if (id === '' || id === null || id === undefined) return null;
  var c = W.cache[key] && W.cache[key][String(id)];
  if (c) return c;
  if (W.full[key]) return null;
  var d = fsGet_(key + '/' + id);
  return d ? remember_(key, d) : null;
}

function append_(key, obj) {
  var id = obj.id ? String(obj.id) : (key === 'log' ? 'L' + Date.now().toString(36) + uid10_() : (key === 'alerts' ? 'A' + Date.now().toString(36) + uid10_() : uid10_()));
  var data = {}; for (var k in obj) if (k !== '_row') data[k] = obj[k] === undefined || obj[k] === null ? '' : (typeof obj[k] === 'object' || typeof obj[k] === 'boolean' ? obj[k] : String(obj[k]));
  if (key === 'calls') { data.archived = false; data.cust = custSnap_(obj.customerId ? find_('customers', obj.customerId) : null); }
  if (key === 'visits') data.archived = false;
  fsCommit_([{ path: key + '/' + id, data: data }]);
  if (COL_KEYS[key]) { data._row = id; remember_(key, data); if (W.full[key]) W.full[key].push(data); }
  return obj;
}

function update_(key, row, patch) {
  var data = {}; for (var k in patch) data[k] = patch[k] === undefined || patch[k] === null ? '' : (typeof patch[k] === 'object' || typeof patch[k] === 'boolean' ? patch[k] : String(patch[k]));
  var writes = [{ path: key + '/' + row, data: data, merge: true }];
  var old = W.cache[key] && W.cache[key][String(row)];
  if (old) {   // עותק חדש: מי שמחזיק את האובייקט הקודם רואה את הערכים הקודמים
    var o = {}; for (var k1 in old) o[k1] = old[k1];
    for (var k2 in data) o[k2] = data[k2];
    W.cache[key][String(row)] = o;
    if (W.full[key]) { var pos = W.full[key].indexOf(old); if (pos >= 0) W.full[key][pos] = o; }
  }
  if (key === 'customers') {
    var cu = {}, base = find_('customers', row) || {};
    for (var b in base) cu[b] = base[b];
    for (var d2 in data) cu[d2] = data[d2];
    var snap = custSnap_(cu);
    fsQuery_('calls', [['customerId', 'EQUAL', String(row)]]).forEach(function (c) { writes.push({ path: 'calls/' + c._row, data: { cust: snap }, merge: true }); });
  }
  fsCommit_(writes);
}

function custSnap_(cu) {
  cu = cu || {};
  return { name: cu.name || '', phone: cu.phone || '', address: cu.address || '', city: cu.city || '', region: cu.region || '', type: cu.type || '' };
}

function settings_() {
  if (W.settings) return W.settings;
  var o = {}; sheetRows_('settings').forEach(function (s) { o[s.key] = s.value; });
  if (!live_()) { o.cal_sync = 'לא'; o.wa_alerts = 'לא'; }
  W.settings = o;
  return o;
}
function setSetting_(key, value) {
  var s = sheetRows_('settings').filter(function (r) { return r.key === key; })[0], sh = ss_().getSheetByName(SCHEMA.settings.tab);
  if (s) sh.getRange(s._row, 2).setValue(String(value));
  else sh.appendRow([key, String(value), '']);
  W.sheet.settings = null; W.settings = null;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function uid10_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function visitsOf_(callId) { return fsQuery_('visits', [['callId', 'EQUAL', String(callId)]]).sort(function (a, b) { return a.at < b.at ? -1 : 1; }); }
function logOf_(callId) { return fsQuery_('log', [['callId', 'EQUAL', String(callId)]]); }
function nextCallId_() {
  var c = fsGet_('meta/counter'), n = Number(c && c.next || 1001);
  fsCommit_([{ path: 'meta/counter', data: { next: n + 1 }, merge: true }]);
  return String(n);
}
function saveFile_() { return ''; }
function setAccess_(uid, oldEmail, newEmail) {
  var u = find_('users', uid); if (!u) return;
  oldEmail = String(oldEmail || '').toLowerCase(); newEmail = String(newEmail || '').toLowerCase();
  var w = [];
  if (oldEmail && oldEmail !== newEmail) w.push({ path: 'access/' + oldEmail, del: true });
  if (newEmail) w.push({ path: 'access/' + newEmail, data: { uid: uid, role: u.role, kind: u.kind || '', active: u.active === 'לא' ? 'לא' : 'כן' } });
  if (w.length) fsCommit_(w);
}

/* ===================== יומן Google אישי לכל טכנאי ===================== */

function techCalendar_(u, create) {
  if (u.calId) { try { var c0 = CalendarApp.getCalendarById(u.calId); if (c0) return c0; } catch (e) {} }
  if (!create) return null;
  var cal = CalendarApp.createCalendar('MTI שירות – ' + u.name, { timeZone: TZ });
  update_('users', u._row, { calId: cal.getId() });
  return cal;
}

/** יוצר / מעדכן / מוחק את האירוע של הקריאה ביומן של הטכנאי המשובץ */
function syncCall_(id) {
  if (settings_().cal_sync === 'לא') return;
  var c = find_('calls', id);
  if (!c) return;
  var u = c.assignedUser ? find_('users', c.assignedUser) : null;
  var want = u && u.role === 'tech' && c.date && c.status !== 'בוטלה' && c.status !== 'נפתחה';
  var t = want ? callEventText_(c) : null;
  var sig = want ? [u.id, c.date, c.time, c.endTime, hash_(t.title + t.desc + t.location)].join('|') : '';
  if (sig && sig === c.calSig && c.calEventId) return;   // לא השתנה כלום
  if (c.calEventId && c.calOwner) {
    var owner = find_('users', c.calOwner);
    var oc = owner ? techCalendar_(owner, false) : null;
    if (oc) { try { var oe = oc.getEventById(c.calEventId); if (oe) oe.deleteEvent(); } catch (e) {} }
  }
  var patch = { calEventId: '', calOwner: '', calSig: '' };
  if (want) {
    var cal = techCalendar_(u, true), ev;
    if (c.time) {
      var st = Utilities.parseDate(c.date + ' ' + c.time, TZ, 'yyyy-MM-dd HH:mm');
      var en = c.endTime && c.endTime > c.time ? Utilities.parseDate(c.date + ' ' + c.endTime, TZ, 'yyyy-MM-dd HH:mm')
        : new Date(st.getTime() + Math.min(unitsFor_(c.product, c.callType, settings_()) * 120, 540) * 60000);
      ev = cal.createEvent(t.title, st, en, { description: t.desc, location: t.location });
    } else {
      ev = cal.createAllDayEvent(t.title, Utilities.parseDate(c.date + ' 12:00', TZ, 'yyyy-MM-dd HH:mm'), { description: t.desc, location: t.location });
    }
    try { ev.removeAllReminders(); ev.addPopupReminder(60); } catch (e) {}
    patch = { calEventId: ev.getId(), calOwner: u.id, calSig: sig };
  }
  if (patch.calEventId !== (c.calEventId || '') || patch.calSig !== (c.calSig || '')) update_('calls', c._row, patch);
}

function shareCalendar_(cal, email) {
  if (typeof Calendar === 'undefined') throw new Error('צריך להפעיל את שירות Google Calendar API בפרויקט');
  Calendar.Acl.insert({ role: 'reader', scope: { type: 'user', value: email } }, cal.getId(), { sendNotifications: true });
}

/** טכנאים שקיבלו מייל חדש באפליקציה: משתפים את היומן האישי */
function processCalShares_() {
  if (!live_()) return 0;
  var n = 0;
  fsQuery_('users', [['calShare', 'EQUAL', 'pending']]).forEach(function (u) {
    try {
      if (u.email && u.role === 'tech') {
        remember_('users', u);
        shareCalendar_(techCalendar_(u, true), u.email);
        log_(u.id, '', 'יומן שותף', u.name + ' · ' + u.email);
      }
      update_('users', u._row, { calShare: 'done' }); n++;
    } catch (e) { Logger.log('שיתוף יומן ' + u.id + ': ' + e); }
  });
  return n;
}

/* ===================== וואטסאפ ===================== */

function notify_(to, template, params) {
  var s = settings_();
  if (!s.wa_endpoint || !s.wa_key) return 'לא מוגדר';
  var res = UrlFetchApp.fetch(s.wa_endpoint, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-MTI-Key': s.wa_key },
    payload: JSON.stringify({ to: waPhone_(to), template: template, params: params })
  });
  var code = res.getResponseCode(), body = res.getContentText().slice(0, 300);
  return code === 200 && /"ok"\s*:\s*true/.test(body) ? 'נשלח' : 'שגיאה ' + code + ': ' + body;
}

function alertsTick() {
  var s = settings_();
  if (!live_() || s.wa_alerts === 'לא' || !s.wa_endpoint || !s.wa_key) return;
  var hhmm = Utilities.formatDate(new Date(), TZ, 'HH:mm'), nowMin = toMinS_(hhmm), today = today_();
  if (nowMin < 5 * 60 || nowMin > 21 * 60) return;
  var users = {}; read_('users').forEach(function (u) { if (u.active !== 'לא') users[u.id] = u; });
  var calls = fsQuery_('calls', [['date', 'EQUAL', today]]);
  var custs = {}; calls.forEach(function (c) { if (c.customerId && !custs[c.customerId]) custs[c.customerId] = c.cust || find_('customers', c.customerId) || {}; });
  var sent = {}; read_('alerts').forEach(function (a) { if (String(a.at).slice(0, 10) === today && a.result === 'נשלח') sent[a.key] = 1; });
  dueAlerts_(calls, users, custs, today, nowMin, Number(s.remind_min || 60), Number(s.late_min || 15), sent).forEach(function (a) {
    var r;
    try { r = notify_(a.to, a.type, a.params); } catch (e) { r = 'שגיאה: ' + e; }
    append_('alerts', { at: now_(), key: a.key, callId: a.callId, userId: a.userId, type: a.type === 'tech_visit_reminder' ? 'תזכורת' : 'איחור', to: a.to, result: r });
  });
}

/* ===================== סיכום יומי ===================== */

function dailySummary() {
  if (!live_()) return;
  var s = settings_(), today = today_();
  var users = {}; read_('users').forEach(function (u) { users[u.id] = u; });
  var nm = function (id) { return id === 'gcal' ? 'יומן גוגל' : users[id] ? users[id].name : id; };
  var calls = read_('calls');
  var callLine = function (c) { if (isTask_(c)) return '#' + c.id + ' · משימה: ' + taskTitle_(c); var cu = c.cust || {}; return '#' + c.id + ' · ' + [cu.city, cu.name, fullLabel_(c)].filter(String).join(' · '); };
  var opened = calls.filter(function (c) { return String(c.createdAt).slice(0, 10) === today; });
  var closed = calls.filter(function (c) { return String(c.closedAt).slice(0, 10) === today && c.status === 'נסגרה'; });
  var stuck = calls.filter(function (c) { return isStuck_(c, s, today); });
  var logs = read_('log');
  var overrides = logs.filter(function (l) { return l.action === 'שיבוץ שונה מההצעה'; });
  var urgents = logs.filter(function (l) { return l.action === 'סומנה דחופה'; });
  var cash = read_('visits').filter(function (v) { return v.payMethod === 'מזומן' && !v.cashAt && Number(v.amount) > 0 && daysSince_(v.at, today) >= Number(s.cash_days || 3); });
  var unavail = logs.filter(function (l) { return l.action === 'חזר לתיאום'; });

  function esc(t) { return String(t || '').replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; }); }
  function section(title, items) {
    return '<h3 style="margin:18px 0 6px;font-size:16px">' + esc(title) + ' (' + items.length + ')</h3>' +
      (items.length ? '<ul style="margin:0;padding-inline-start:18px">' + items.map(function (i) { return '<li style="margin:3px 0">' + i + '</li>'; }).join('') + '</ul>' : '<div style="color:#777">אין</div>');
  }
  var ovItems = overrides.map(function (l) { return '<b>#' + esc(l.callId) + '</b> · ' + esc(nm(l.userId)) + ': ' + esc(l.details) + (l.reason ? '<br><span style="color:#555">סיבה: ' + esc(l.reason) + '</span>' : ''); });
  var urItems = urgents.map(function (l) { return '<b>#' + esc(l.callId) + '</b> · ' + esc(nm(l.userId)) + '<br><span style="color:#555">סיבה: ' + esc(l.reason) + '</span>'; });
  var dateTxt = dayLabel_(today);
  var wrap = function (body) { return '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">' + body + '</div>'; };

  var full = '<h2 style="margin:0 0 4px">סיכום שירות · ' + dateTxt + '</h2>' +
    section('נפתחו היום', opened.map(function (c) { return esc(callLine(c)) + (c.urgent === 'כן' ? ' <b style="color:#b00">דחוף</b>' : ''); })) +
    section('נסגרו היום', closed.map(function (c) { return esc(callLine(c)) + ' · ' + esc(nm(c.assignedUser)); })) +
    section('שינויי שיבוץ של רחלי', ovItems) +
    section('סומנו דחופות ידנית', urItems) +
    section('חזרו לתיאום (לקוח לא זמין / טכנאי לא הגיע)', unavail.map(function (l) { var c = find_('calls', l.callId) || {}; return esc(callLine(c)) + ' · ' + esc(nm(l.userId)) + '<br><span style="color:#555">' + esc(l.reason) + '</span>'; })) +
    section('קריאות תקועות (' + (s.stuck_days || 5) + ' ימי עבודה בלי שינוי)', stuck.map(function (c) { return esc(callLine(c)) + ' · ' + esc(c.status) + (c.assignedUser ? ' · ' + esc(nm(c.assignedUser)) : ''); })) +
    section('מזומן בשטח מעל ' + (s.cash_days || 3) + ' ימים', cash.map(function (v) { return esc(nm(v.userId)) + ' · ' + money_(v.amount) + ' · קריאה #' + esc(v.callId) + ' · ' + daysSince_(v.at, today) + ' ימים'; }));

  var to = list_(s.summary_emails);
  if (to.length) MailApp.sendEmail({ to: to.join(','), subject: 'סיכום שירות יומי · ' + dateTxt, htmlBody: wrap(full), name: APP_NAME });

  var kobi = list_(s.kobi_emails);
  if (kobi.length && (overrides.length || urgents.length)) {
    MailApp.sendEmail({ to: kobi.join(','), subject: 'שינויי שיבוץ ודחיפויות · ' + dateTxt, name: APP_NAME,
      htmlBody: wrap('<h2 style="margin:0 0 4px">שינויי שיבוץ · ' + dateTxt + '</h2>' + section('שינויי שיבוץ', ovItems) + section('סומנו דחופות ידנית', urItems)) });
  }
}
