/* ===================== יומן Google המשותף ('יומן שירות ספא') – סנכרון דו-כיווני =====================
 * כל קריאה שנפתחה באפליקציה ויש לה תאריך = אירוע אחד ביומן המשותף.
 * השיבוץ רק באפליקציה: הצבע ושם הטכנאי בכותרת נקבעים ממנה.
 * גרירה / קיצור / הארכה / מחיקה של האירוע ביומן גוגל חוזרים לאפליקציה.
 * אירועים שלא נוצרו מהאפליקציה (ולא קושרו בייבוא) – לא נוגעים בהם.
 */
// צבעי גוגל: 11 אדום, 9 כחול, 5 צהוב, 10 ירוק, 3 סגול, 8 אפור, 4 ורוד
var GCAL_TECH_COLORS = { jaber: '11', ali: '9', tal: '5', liran: '10', ronen: '3' };
var GCAL_NONE = '8', GCAL_SELF_PICKUP = '4';

function sharedCal_() {
  var id = prop_('GCAL_SHARED_ID');
  if (!id || settings_().gcal_shared === 'לא') return null;
  return CalendarApp.getCalendarById(id);
}

function hash_(str) { var h = 5381; str = String(str); for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h >>> 0); }

function callRange_(c) {
  if (!c.time) return { allDay: true };
  var st = Utilities.parseDate(c.date + ' ' + c.time, TZ, 'yyyy-MM-dd HH:mm');
  var mins = isTask_(c) ? 60 : Math.min(unitsFor_(c.product, c.callType, settings_()) * 120, 540);
  var en = c.endTime && c.endTime > c.time ? Utilities.parseDate(c.date + ' ' + c.endTime, TZ, 'yyyy-MM-dd HH:mm') : new Date(st.getTime() + mins * 60000);
  return { allDay: false, start: st, end: en };
}

function callSig_(c) {
  if (!c.date) return '';
  var r = callRange_(c);
  return r.allDay ? 'D' + c.date : Utilities.formatDate(r.start, TZ, 'yyyy-MM-dd HH:mm') + '|' + Utilities.formatDate(r.end, TZ, 'yyyy-MM-dd HH:mm');
}

function evSig_(ev) {
  if (ev.isAllDayEvent()) return 'D' + Utilities.formatDate(ev.getAllDayStartDate(), TZ, 'yyyy-MM-dd');
  return Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd HH:mm') + '|' + Utilities.formatDate(ev.getEndTime(), TZ, 'yyyy-MM-dd HH:mm');
}

/** מועד האירוע בגוגל → שדות הקריאה */
function evToCall_(ev) {
  if (ev.isAllDayEvent()) return { date: Utilities.formatDate(ev.getAllDayStartDate(), TZ, 'yyyy-MM-dd'), time: '', endTime: '' };
  var d = Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd'), d2 = Utilities.formatDate(ev.getEndTime(), TZ, 'yyyy-MM-dd');
  var t = Utilities.formatDate(ev.getStartTime(), TZ, 'HH:mm'), e = Utilities.formatDate(ev.getEndTime(), TZ, 'HH:mm');
  return { date: d, time: t, endTime: d2 === d && e > t ? e : '' };
}

function sharedWant_(c) {
  if (!c.date || c.status === 'בוטלה') return false;
  return !!c.gEventId || c.date >= today_();
}

function sharedContent_(c) {
  var t = callEventText_(c);
  var u = c.assignedUser ? find_('users', c.assignedUser) : null;
  var title = t.title.replace(/ #\d+$/, '') + (u ? ' (' + u.name + ')' : isTask_(c) ? '' : ' (לא משובץ)');
  var desc = t.desc + '\n\nקריאה מספר ' + c.id + ' באפליקציה MTI שירות.\nאת הטכנאי והפרטים משנים באפליקציה. את המועד אפשר לגרור כאן.';
  var color = /איסוף עצמי/.test(String(c.description || '') + ' ' + t.title) ? GCAL_SELF_PICKUP : u ? (GCAL_TECH_COLORS[u.id] || '1') : GCAL_NONE;
  return { title: title, desc: desc, location: t.location, color: color };
}

function prefixTitle_(ev, p) { var t = ev.getTitle(); if (t.indexOf(p) !== 0) ev.setTitle(p + t.replace(/^(✓ |↩ |✗ )/, '')); }

/** מעדכן את האירוע לפי הקריאה. מחזיר את השדות לשמירה בקריאה. */
function pushShared_(cal, c, ev) {
  var adopted = c.gAdopted === 'כן';
  if (!sharedWant_(c)) {
    if (ev) {
      if (adopted) prefixTitle_(ev, c.status === 'בוטלה' ? '✗ ' : '↩ ');   // אירוע מקורי של המשרד – לא מוחקים
      else ev.deleteEvent();
    }
    return { gEventId: '', gSeen: '', gText: '', gAdopted: '' };
  }
  var r = callRange_(c), k = sharedContent_(c), noon = Utilities.parseDate(c.date + ' 12:00', TZ, 'yyyy-MM-dd HH:mm');
  if (!ev) {
    ev = r.allDay ? cal.createAllDayEvent(k.title, noon, { description: k.desc, location: k.location })
                  : cal.createEvent(k.title, r.start, r.end, { description: k.desc, location: k.location });
    try { ev.setColor(k.color); } catch (e) {}
    return { gEventId: ev.getId(), gSeen: callSig_(c), gText: hash_(k.title + k.desc + k.location + k.color), gAdopted: '' };
  }
  if (evSig_(ev) !== callSig_(c)) { if (r.allDay) ev.setAllDayDate(noon); else ev.setTime(r.start, r.end); }
  var h = hash_(k.title + k.desc + k.location + k.color);
  if (adopted) {
    if (c.status === 'נסגרה') prefixTitle_(ev, '✓ ');
    if (h !== c.gText) { try { ev.setColor(k.color); } catch (e) {} }
  } else if (h !== c.gText) {   // רק כשהקריאה השתנתה באפליקציה – כדי לא לדרוס הערה שנכתבה ביומן
    ev.setTitle(k.title); ev.setDescription(k.desc); ev.setLocation(k.location);
    try { ev.setColor(k.color); } catch (e) {}
  }
  return { gEventId: ev.getId(), gSeen: callSig_(c), gText: h, gAdopted: adopted ? 'כן' : '' };
}

function reconcileOne_(cal, c, byId, win, st) {
  var ev = null;
  if (c.gEventId) {
    ev = byId[c.gEventId] || null;
    if (!ev) {
      ev = cal.getEventById(c.gEventId);
      // בסריקה מלאה: אירוע שהיה אמור להופיע בחלון ולא הופיע – נמחק
      if (ev && win && c.gSeen) { var s0 = ev.getStartTime().getTime(); if (s0 >= win.from && s0 < win.to) ev = null; }
    }
  }
  var cS = callSig_(c);
  if (c.gEventId && !ev) { applyGcalDeleted_(c, st); return; }   // נמחק ביומן גוגל
  if (ev && c.gSeen && evSig_(ev) !== c.gSeen && cS === c.gSeen) {   // הוזז ביומן גוגל (והאפליקציה לא שינתה מועד)
    applyGcalMoved_(c, evToCall_(ev), null, st);
    c = find_('calls', c.id);
  }
  var out = pushShared_(cal, c, ev);
  if (!ev && out.gEventId) st.created++;
  if (out.gEventId !== c.gEventId || out.gSeen !== c.gSeen || out.gText !== c.gText || out.gAdopted !== c.gAdopted) {
    update_('calls', c._row, out); st.pushed++;
  }
}

/** אירוע נמחק ביומן גוגל → הקריאה חוזרת לתיאום (בלי תאריך) */
function applyGcalDeleted_(c, st) {
  var patch = { gEventId: '', gSeen: '', gText: '', gAdopted: '' };
  if (c.status !== 'נסגרה' && c.status !== 'בוטלה' && c.date) {
    patch.date = ''; patch.time = ''; patch.endTime = '';
    if (c.assignedUser) patch.status = 'לתיאום מחדש';
    log_('gcal', c.id, 'נמחקה מיומן גוגל', 'הוחזרה לתיאום (היה ' + c.date + ' ' + (c.time || '') + ')');
  }
  touch_(c, patch); st.removed++;
  try { syncCall_(c.id); } catch (e) {}
}

/** אירוע הוזז ביומן גוגל → מועד הקריאה מתעדכן */
function applyGcalMoved_(c, nv, sig, st) {
  var mv = { date: nv.date, time: nv.time, endTime: nv.endTime };
  if (sig) mv.gSeen = sig;
  if (c.status === 'לתיאום מחדש' && (c.assignedUser || isSelfPickup_(c))) mv.status = 'תואם מועד';
  log_('gcal', c.id, 'הוזזה ביומן גוגל', (c.date + ' ' + (c.time || '')).trim() + ' ← ' + nv.date + ' ' + (nv.time ? nv.time + (nv.endTime ? '–' + nv.endTime : '') : 'ללא שעה'));
  touch_(c, mv);
  st.pulled++;
  try { syncCall_(c.id); } catch (e) {}
}

/** סנכרון: onlyId = קריאה אחת (אחרי פעולה באפליקציה); בלי = סריקה מלאה (לילית).
 *  הנעילה נלקחת רק לכל קריאה בנפרד, כדי לא לעכב את המשתמשים. */
function gcalReconcile_(onlyId) {
  var cal = sharedCal_();
  if (!cal) return { off: true };
  var cache = CacheService.getScriptCache();
  if (!onlyId) { if (cache.get('gcal_full')) return { busy: true }; cache.put('gcal_full', '1', 600); }
  try {
    resetCache_();
    var st = { created: 0, pushed: 0, pulled: 0, removed: 0, errors: 0 }, byId = {}, win = null;
    if (!onlyId) {
      var from = new Date(Date.now() - 30 * 86400000), to = new Date(Date.now() + 400 * 86400000);
      win = { from: from.getTime(), to: to.getTime() };
      cal.getEvents(from, to).forEach(function (e) { byId[e.getId()] = e; });
    }
    var pool = onlyId ? [find_('calls', onlyId)].filter(Boolean) : read_('calls');
    var ids = pool.filter(function (c) {
      if (onlyId) return true;
      if (!c.gEventId && !sharedWant_(c)) return false;
      // בסריקה מלאה מדלגים על מה שכבר מסונכרן (בלי לנעול)
      var ev = c.gEventId ? byId[c.gEventId] : null;
      if (ev && c.gSeen && evSig_(ev) === c.gSeen && callSig_(c) === c.gSeen && sharedWant_(c)) {
        var k = sharedContent_(c);
        if (c.gAdopted === 'כן' || hash_(k.title + k.desc + k.location + k.color) === c.gText) return false;
      }
      return true;
    }).map(function (c) { return c.id; });
    ids.forEach(function (id) {
      try {
        withLock_(function () {
          if (!onlyId) resetCache_();
          var c = find_('calls', id);
          if (!c || (!c.gEventId && !sharedWant_(c))) return;
          reconcileOne_(cal, c, byId, win, st);
        });
      } catch (e) { st.errors++; Logger.log('יומן שירות ספא – קריאה ' + id + ': ' + e); }
    });
    return st;
  } finally { if (!onlyId) cache.remove('gcal_full'); }
}

/* ---- שינויים מהאפליקציה: כל קריאה ש-_ts שלה חדש מהפעם הקודמת ---- */
function processChanged_() {
  var props = PropertiesService.getScriptProperties(), last = props.getProperty('FS_LAST_TS') || '';
  if (!last) { var top = fsQuery_('calls', [], ['_ts', 'DESCENDING'], 1); props.setProperty('FS_LAST_TS', top.length ? top[0]._ts : new Date().toISOString()); return 0; }
  var rows = fsQuery_('calls', [['_ts', 'GREATER_THAN', { __ts: last }]], ['_ts'], 200);
  var max = last;
  rows.forEach(function (c) {
    if (new Date(c._ts).getTime() >= new Date(max).getTime()) max = c._ts;
    resetCache_(); remember_('calls', c);
    syncCallSafe_(c.id);
  });
  if (max !== last) props.setProperty('FS_LAST_TS', max);
  return rows.length;
}

function syncCallSafe_(id) {
  if (!id) return;
  try { syncCall_(id); } catch (e) { Logger.log('סנכרון יומן נכשל לקריאה ' + id + ': ' + e); }
  try { gcalReconcile_(id); } catch (e) { Logger.log('סנכרון יומן שירות ספא נכשל לקריאה ' + id + ': ' + e); }
}

/* ---- משיכת שינויים מיומן גוגל: רק מה שהשתנה (syncToken) ---- */
function itemSig_(it) {
  if (it.start && it.start.date) return 'D' + it.start.date;
  return Utilities.formatDate(new Date(it.start.dateTime), TZ, 'yyyy-MM-dd HH:mm') + '|' + Utilities.formatDate(new Date(it.end.dateTime), TZ, 'yyyy-MM-dd HH:mm');
}

function itemToCall_(it) {
  if (it.start && it.start.date) return { date: it.start.date, time: '', endTime: '' };
  var s = new Date(it.start.dateTime), e = new Date(it.end.dateTime);
  var d = Utilities.formatDate(s, TZ, 'yyyy-MM-dd'), d2 = Utilities.formatDate(e, TZ, 'yyyy-MM-dd');
  var t = Utilities.formatDate(s, TZ, 'HH:mm'), et = Utilities.formatDate(e, TZ, 'HH:mm');
  return { date: d, time: t, endTime: d2 === d && et > t ? et : '' };
}

function gcalPull_() {
  var cal = sharedCal_();
  if (!cal) return { off: true };
  if (typeof Calendar === 'undefined') return gcalReconcile_();
  var props = PropertiesService.getScriptProperties(), tok = props.getProperty('GCAL_SYNC_TOKEN'), calId = cal.getId();
  var items = [], pageToken = null, next = null, resp;
  try {
    do {
      var args = tok ? { syncToken: tok, showDeleted: true, maxResults: 2500 } : { maxResults: 2500 };
      if (pageToken) args.pageToken = pageToken;
      resp = Calendar.Events.list(calId, args);
      if (tok) items = items.concat(resp.items || []);
      pageToken = resp.nextPageToken;
      if (resp.nextSyncToken) next = resp.nextSyncToken;
    } while (pageToken);
  } catch (e) {
    if (/410|sync token|syncToken/i.test(String(e))) { props.deleteProperty('GCAL_SYNC_TOKEN'); return gcalReconcile_(); }
    throw e;
  }
  if (next) props.setProperty('GCAL_SYNC_TOKEN', next);
  if (!tok) return { init: true };
  var st = { pulled: 0, removed: 0, errors: 0, changed: items.length };
  if (!items.length) return st;
  var byKey = {};
  items.forEach(function (it) { if (it.id) byKey[it.id] = it; if (it.iCalUID) byKey[it.iCalUID] = it; });
  var itemFor = function (c) { return c.gEventId ? byKey[c.gEventId] || byKey[String(c.gEventId).split('@')[0]] : null; };
  var keys = Object.keys(byKey).filter(function (k) { return /@/.test(k); }), found = {};
  for (var q = 0; q < keys.length; q += 30) fsQuery_('calls', [['gEventId', 'IN', keys.slice(q, q + 30)]]).forEach(function (c) { found[c.id] = 1; });
  var ids = Object.keys(found);
  ids.forEach(function (id) {
    try {
      withLock_(function () {
        resetCache_();
        var c = find_('calls', id), it = c && itemFor(c);
        if (!it) return;
        if (it.status === 'cancelled') { applyGcalDeleted_(c, st); return; }
        var sig = itemSig_(it);
        if (c.gSeen && sig !== c.gSeen && callSig_(c) === c.gSeen) applyGcalMoved_(c, itemToCall_(it), sig, st);
      });
    } catch (e) { st.errors++; Logger.log('משיכה מיומן גוגל – קריאה ' + id + ': ' + e); }
  });
  return st;
}

/**
 * טריגר: כל שינוי ביומן + כל 5 דקות + "דחיפה" מהאפליקציה אחרי שמירה.
 * רק ריצה אחת בכל רגע. מי שמגיע כשמישהו כבר רץ משאיר דגל, והריצה הפעילה עושה סבב נוסף –
 * כך שינוי לא נתקע עד הטריגר הבא.
 */
function gcalTick() {
  var cache = CacheService.getScriptCache();
  cache.put('tick_again', '1', 600);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) return { queued: true };
  W.locked = true;
  var r = null, n = 0;
  try {
    while (cache.get('tick_again') && n++ < 6) { cache.remove('tick_again'); resetCache_(); r = tickOnce_(); }
  } finally { W.locked = false; lock.releaseLock(); }
  // דגל שהגיע בדיוק ברגע השחרור – עוד סבב
  if (cache.get('tick_again') && lock.tryLock(500)) {
    W.locked = true;
    try { cache.remove('tick_again'); resetCache_(); r = tickOnce_(); } finally { W.locked = false; lock.releaseLock(); }
  }
  return r;
}

function tickOnce_() {
  var n = 0, r = null, cfg = null;
  try { cfg = syncConfig_(); } catch (e) { Logger.log('הגדרות: ' + e); }
  try { n = processChanged_(); } catch (e) { Logger.log('שינויים: ' + e); }
  try { processCalShares_(); } catch (e) { Logger.log('שיתוף יומנים: ' + e); }
  r = gcalPull_();
  if (n || (r && (r.pulled || r.removed || r.errors))) Logger.log('שינויים ' + n + ' · ' + JSON.stringify(r));
  return { changed: n, pull: r, cfg: cfg };
}

/** טריגר לילי: סריקה מלאה לביטחון + ארכיון + גיבוי לגיליון */
function gcalNightly() {
  var r = gcalReconcile_();
  try { archiveOld_(); } catch (e) { Logger.log('ארכיון: ' + e); }
  try { if (prop_('MIRROR_ON') === 'yes') mirrorToSheet(); } catch (e) { Logger.log('גיבוי: ' + e); }
  Logger.log(JSON.stringify(r));
  return r;
}

