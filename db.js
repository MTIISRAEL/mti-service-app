/**
 * MTI שירות – שכבת הנתונים בדפדפן.
 * עותק חי של הנתונים בזיכרון (מתעדכן מ-Firestore בזמן אמת), כך שכל פעולה רצה מיד בטלפון.
 * כתיבות נאספות לאצווה אחת לכל פעולה ונשלחות ל-Firestore ברקע.
 */
var TZ = 'Asia/Jerusalem';
var COLS = ['users', 'customers', 'calls', 'visits'];
var DB = {
  col: { users: [], customers: [], calls: [], visits: [] },
  idx: { users: {}, customers: {}, calls: {}, visits: {} },
  settings: {}, match: [], prices: [],
  oldMonths: {}, oldAll: null, alerts: [],
  writes: [], reservedId: null, unsub: [], me: null, ready: false
};

/* ---- זמן ---- */
var _fmt = null;
function _parts(d) {
  _fmt = _fmt || new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var o = {}; _fmt.formatToParts(d || new Date()).forEach(function (p) { o[p.type] = p.value; });
  return o;
}
function now_() { var o = _parts(); return o.year + '-' + o.month + '-' + o.day + ' ' + o.hour + ':' + o.minute; }
function today_() { var o = _parts(); return o.year + '-' + o.month + '-' + o.day; }
function uid10_() {
  var a = new Uint8Array(8); (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 10);
}

/* ---- המרות ---- */
function clean_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return v;
  if (typeof v === 'boolean') return v;
  return String(v);
}
function docToObj_(id, d) {
  var o = {};
  for (var k in d) if (k !== '_ts') o[k] = d[k];
  o._row = id;
  if (o.id === undefined) o.id = id;
  return o;
}
function custSnap_(cu) {
  cu = cu || {};
  return { name: cu.name || '', phone: cu.phone || '', address: cu.address || '', city: cu.city || '', region: cu.region || '', type: cu.type || '' };
}

/* ---- קריאה ---- */
function isTechMode_() { return DB.me && DB.me.role === 'tech'; }
function read_(key) {
  if (key === 'match') return DB.match;
  if (key === 'prices') return DB.prices;
  if (key === 'alerts') return DB.alerts;
  if (key === 'log') return [];
  if (key === 'oldcal') return oldList_();
  if (key === 'customers' && isTechMode_()) {
    // טכנאי לא קורא את רשימת הלקוחות: פרטי הלקוח נשמרים בתוך הקריאה
    var seen = {}, out = [];
    DB.col.calls.forEach(function (c) {
      if (!c.customerId || seen[c.customerId]) return;
      seen[c.customerId] = 1;
      var o = custSnap_(c.cust); o.id = c.customerId; o._row = c.customerId; out.push(o);
    });
    return out;
  }
  return DB.col[key] || [];
}
function find_(key, id, field) {
  if ((!field || field === 'id') && DB.idx[key]) {
    if (key === 'customers' && isTechMode_()) return read_('customers').filter(function (x) { return x.id === String(id); })[0] || null;
    return DB.idx[key][String(id)] || null;
  }
  field = field || 'id';
  var rows = read_(key);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][field]) === String(id)) return rows[i];
  return null;
}
function settings_() { return DB.settings; }
function visitsOf_(callId) { return DB.col.visits.filter(function (v) { return String(v.callId) === String(callId); }); }
function logOf_() { return []; }   // נטען בנפרד (getCall)
function resetCache_() {}
function withLock_(fn) { return fn(); }

/* ---- כתיבה (נאספת לאצווה) ---- */
function queue_(path, data, isNew) { DB.writes.push({ path: path, data: data, isNew: isNew }); }

function append_(key, obj) {
  var id = obj.id ? String(obj.id) : (key === 'log' ? 'L' + Date.now().toString(36) + uid10_() : uid10_());
  var data = {};
  for (var k in obj) if (k !== '_row') data[k] = clean_(obj[k]);
  if (key === 'calls') { data.archived = false; data.cust = custSnap_(obj.customerId ? find_('customers', obj.customerId) : null); }
  if (key === 'visits') data.archived = false;
  queue_(key + '/' + id, data, true);
  if (DB.idx[key]) {
    var o = docToObj_(id, data);
    DB.col[key].push(o); DB.idx[key][id] = o;
  }
  return obj;
}

function update_(key, row, patch) {
  var id = String(row), data = {};
  for (var k in patch) data[k] = clean_(patch[k]);
  // עותק חדש (ולא שינוי במקום): הקוד המשותף משתמש בערכים הקודמים אחרי העדכון (למשל ביומן השינויים)
  var old = DB.idx[key] && DB.idx[key][id], o = null;
  if (old) {
    o = {}; for (var k1 in old) o[k1] = old[k1];
    for (var k2 in data) o[k2] = data[k2];
    DB.idx[key][id] = o;
    var arr = DB.col[key], pos = arr.indexOf(old); if (pos >= 0) arr[pos] = o;
  }
  queue_(key + '/' + id, data, false);
  // פרטי לקוח שהשתנו מתעדכנים גם בתוך הקריאות שלו (שם הטכנאי קורא אותם)
  if (key === 'customers' && o) {
    var snap = custSnap_(o);
    DB.col.calls.forEach(function (c) {
      if (c.customerId !== id) return;
      c.cust = snap; queue_('calls/' + c._row, { cust: snap }, false);   // השדה cust לא נקרא ע"י הקוד המשותף
    });
  }
}

function setSetting_(key, value) {
  if (key === 'next_call_id') return;   // המונה מנוהל בטרנזקציה
  DB.settings[key] = String(value);
  var d = {}; d[key] = String(value);
  queue_('config/settings', d, false);
}

function nextCallId_() {
  if (!DB.reservedId) { var e = new Error('NEED_ID'); e.needId = true; throw e; }
  var id = DB.reservedId; DB.reservedId = null; return id;
}

function saveFile_(dataUrl, name, c, me) {
  if (!/^data:[\w/+.-]+;base64,/.test(String(dataUrl))) return '';
  if (String(dataUrl).length > 1000000) throw new Error('התמונה גדולה מדי');
  var id = 'F' + uid10_();
  queue_('files/' + id, { data: String(dataUrl), name: name, callId: String(c.id), userId: me.id, assignedUser: c.assignedUser || '', at: now_() }, true);
  return id;
}

/* גישה לפי מייל (כללי האבטחה בודקים את המסמך access/<email>) */
function setAccess_(uid, oldEmail, newEmail) {
  var u = DB.idx.users[uid]; if (!u) return;
  oldEmail = String(oldEmail || '').toLowerCase(); newEmail = String(newEmail || '').toLowerCase();
  if (oldEmail && oldEmail !== newEmail) DB.writes.push({ path: 'access/' + oldEmail, del: true });
  if (newEmail) queue_('access/' + newEmail, { uid: uid, role: u.role, kind: u.kind || '', active: u.active === 'לא' ? 'לא' : 'כן' }, true);
}

/** שולח את כל הכתיבות שנאספו בפעולה אחת */
function flushWrites_() {
  var list = DB.writes; DB.writes = [];
  if (!list.length) return Promise.resolve();
  var F = window.FB, chunks = [];
  for (var i = 0; i < list.length; i += 450) chunks.push(list.slice(i, i + 450));
  return Promise.all(chunks.map(function (ch) {
    var b = F.writeBatch(F.db);
    ch.forEach(function (w) {
      var ref = F.doc(F.db, w.path);
      if (w.del) return b.delete(ref);
      var d = {}; for (var k in w.data) d[k] = w.data[k];
      d._ts = F.serverTimestamp();
      b.set(ref, d, { merge: !w.isNew || /^access\//.test(w.path) });
    });
    return b.commit();
  }));
}

/* ---- מונה מספרי קריאות ---- */
function reserveId_() {
  var F = window.FB, ref = F.doc(F.db, 'meta/counter');
  return F.runTransaction(F.db, function (tx) {
    return tx.get(ref).then(function (s) {
      var n = s.exists() ? Number(s.data().next) : Number(DB.settings.next_call_id || 1001);
      tx.set(ref, { next: n + 1 }, { merge: true });
      return String(n);
    });
  });
}

/* ---- האזנה בזמן אמת ---- */
function applySnap_(key, snap, initial) {
  var remote = false;
  snap.docChanges().forEach(function (ch) {
    var id = ch.doc.id, idx = DB.idx[key];
    if (!ch.doc.metadata.hasPendingWrites) remote = true;
    if (ch.type === 'removed') {
      if (idx[id]) { DB.col[key] = DB.col[key].filter(function (x) { return x._row !== id; }); delete idx[id]; }
      return;
    }
    var o = docToObj_(id, ch.doc.data());
    if (idx[id]) {
      var cur = idx[id];
      for (var k in cur) if (!(k in o)) delete cur[k];
      for (var k2 in o) cur[k2] = o[k2];
    } else { DB.col[key].push(o); idx[id] = o; }
  });
  if (key === 'calls') DB.col.calls.sort(function (a, b) { return Number(a.id) - Number(b.id); });
  if (remote && !initial && typeof onRemoteChange === 'function') onRemoteChange(key);
}

function listen_(me) {
  var F = window.FB, db = F.db, waits = [];
  stopListen_();
  DB.me = me;
  COLS.forEach(function (k) { DB.col[k] = []; DB.idx[k] = {}; });
  var staff = ['admin', 'manager', 'office', 'billing'].indexOf(me.role) >= 0;
  var sub = function (name, q, fn) {
    var first = true;
    waits.push(new Promise(function (res) {
      DB.unsub.push(F.onSnapshot(q, { includeMetadataChanges: false }, function (snap) {
        fn(snap, first); if (first) { first = false; res(); }
      }, function (err) {
        console.error(name, err);
        if (first) { first = false; res(); }
      }));
    }));
  };
  sub('settings', F.doc(db, 'config/settings'), function (s) { DB.settings = s.exists() ? s.data() : {}; delete DB.settings._ts; });
  sub('users', F.collection(db, 'users'), function (s, i) { applySnap_('users', s, i); });
  if (staff) {
    sub('match', F.doc(db, 'config/match'), function (s) { DB.match = s.exists() ? (s.data().rows || []) : []; });
    sub('prices', F.doc(db, 'config/prices'), function (s) { DB.prices = s.exists() ? (s.data().rows || []) : []; });
    sub('customers', F.collection(db, 'customers'), function (s, i) { applySnap_('customers', s, i); });
    sub('calls', F.query(F.collection(db, 'calls'), F.where('archived', '==', false)), function (s, i) { applySnap_('calls', s, i); });
    sub('visits', F.query(F.collection(db, 'visits'), F.where('archived', '==', false)), function (s, i) { applySnap_('visits', s, i); });
  } else {
    sub('calls', F.query(F.collection(db, 'calls'), F.where('assignedUser', '==', me.id), F.where('archived', '==', false)), function (s, i) { applySnap_('calls', s, i); });
    sub('visits', F.query(F.collection(db, 'visits'), F.where('userId', '==', me.id), F.where('archived', '==', false)), function (s, i) { applySnap_('visits', s, i); });
  }
  return Promise.all(waits).then(function () { DB.ready = true; });
}
function stopListen_() { DB.unsub.forEach(function (u) { try { u(); } catch (e) {} }); DB.unsub = []; DB.ready = false; }

/* ---- היומן הישן (נטען לפי חודש, לפי דרישה) ---- */
function monthsBetween_(from, to) {
  var out = [], d = from.slice(0, 7);
  while (d <= to.slice(0, 7) && out.length < 4) { out.push(d); var y = +d.slice(0, 4), m = +d.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } d = y + '-' + (m < 10 ? '0' : '') + m; }
  return out;
}
function loadOldMonths_(months) {
  var F = window.FB;
  var need = months.filter(function (m) { return !DB.oldMonths[m]; });
  return Promise.all(need.map(function (m) {
    return F.getDoc(F.doc(F.db, 'oldcal/' + m)).then(function (s) { DB.oldMonths[m] = s.exists() ? (s.data().events || []) : []; })
      .catch(function () { DB.oldMonths[m] = []; });
  }));
}
function loadOldAll_() {
  if (DB.oldAll) return Promise.resolve();
  var F = window.FB;
  return F.getDocs(F.collection(F.db, 'oldcal')).then(function (qs) {
    var all = [];
    qs.forEach(function (d) { DB.oldMonths[d.id] = d.data().events || []; });
    Object.keys(DB.oldMonths).sort().forEach(function (m) { all = all.concat(DB.oldMonths[m]); });
    DB.oldAll = all;
  });
}
function oldList_() {
  if (DB.oldAll) return DB.oldAll;
  var all = []; Object.keys(DB.oldMonths).sort().forEach(function (m) { all = all.concat(DB.oldMonths[m]); });
  return all;
}
/** אירועי היומן הישן בטווח (אחרי loadOldMonths_) */
function oldInRange_(from, to) {
  var seen = {}, out = [];
  monthsBetween_(from, to).forEach(function (m) {
    (DB.oldMonths[m] || []).forEach(function (e) {
      var o = oldSpan_(e);
      o.title = e.title; o.location = e.location; o.color = e.color; o.description = String(e.description || '').slice(0, 400);
      var k = o.start + o.time + o.title;
      if (seen[k] || o.start > to || o.last < from) return;
      seen[k] = 1; out.push(o);
    });
  });
  return out;
}

/* ---- פעולות שצריכות טעינה מהשרת לפני / אחרי ---- */
var ACTIONS_ASYNC = {
  getCall: function (me, p) {
    var v = ACTIONS.getCall(me, p);
    if (!isStaff_(me)) return Promise.resolve(v);
    var F = window.FB;
    v.log = [];
    return F.getDocs(F.query(F.collection(F.db, 'log'), F.where('callId', '==', String(p.id)))).then(function (qs) {
      var rows = []; qs.forEach(function (d) { rows.push(d.data()); });
      rows.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
      v.log = rows.map(function (l) { return { at: l.at, who: userName_(l.userId), action: l.action, details: l.details, reason: l.reason }; });
      return v;
    }).catch(function () { return v; });
  },
  schedule_week: function (me, p) {
    var from = p.from || today_(), n = Math.max(1, Math.min(42, Number(p.days) || 7));
    return (isStaff_(me) ? loadOldMonths_(monthsBetween_(from, addDays_(from, n - 1))) : Promise.resolve()).then(function () { return ACTIONS.schedule_week(me, p); });
  },
  calSearch: function (me, p) { return (isStaff_(me) ? loadOldAll_() : Promise.resolve()).then(function () { return ACTIONS.calSearch(me, p); }); },
  searchOld: function (me, p) { return loadOldAll_().then(function () { return ACTIONS.searchOld(me, p); }); },
  getFile: function (me, p) {
    var F = window.FB;
    return F.getDoc(F.doc(F.db, 'files/' + p.id)).then(function (s) {
      if (!s.exists()) throw new Error('הקובץ לא נמצא');
      return s.data().data;
    });
  },
  adminInfo: function (me, p) {
    var F = window.FB;
    return F.getDocs(F.query(F.collection(F.db, 'alerts'), F.orderBy('at', 'desc'), F.limit(8))).then(function (qs) {
      var a = []; qs.forEach(function (d) { a.push(d.data()); }); DB.alerts = a.reverse();
    }).catch(function () {}).then(function () {
      return F.getDoc(F.doc(F.db, 'meta/oldcal')).then(function (s) { return s.exists() ? Number(s.data().count || 0) : 0; }).catch(function () { return 0; });
    }).then(function (n) { var r = ACTIONS.adminInfo(me, p); r.oldCount = n; return r; });
  }
};
/** מעיר את המנוע ברקע כדי שהיומנים יתעדכנו מיד */
var _kickT = null;
var WORKER_URL = 'https://script.google.com/macros/s/AKfycbxHOz998TfgtRqa8lI6zivPZChEtlCs12g_fsuAa1nMpQ-tAAGn8jMNlSuniK66DIL0/exec';
function kick_() {
  var url = WORKER_URL;
  if (!url) return;
  clearTimeout(_kickT);
  _kickT = setTimeout(function () { try { fetch(url, { method: 'POST', mode: 'no-cors', body: 'k' }).catch(function () {}); } catch (e) {} }, 1500);
}

/** מריץ פעולה מקומית ושולח את הכתיבות. */
function runAction_(me, action, payload) {
  payload = payload || {};
  var fnA = ACTIONS_ASYNC[action], fn = ACTIONS[action];
  if (!fnA && !fn) return Promise.reject(new Error('פעולה לא מוכרת'));
  var attempt = function () {
    DB.writes = [];
    try {
      var r = fnA ? fnA(me, JSON.parse(JSON.stringify(payload))) : fn(me, JSON.parse(JSON.stringify(payload)));
      return Promise.resolve(r);
    } catch (e) {
      DB.writes = [];
      return Promise.reject(e);
    }
  };
  return attempt().catch(function (e) {
    if (!(e && e.needId)) throw e;
    if (!navigator.onLine) throw new Error('אין חיבור לאינטרנט. פתיחת קריאה חדשה צריכה חיבור.');
    return reserveId_().then(function (id) { DB.reservedId = id; return attempt(); });
  }).then(function (r) {
    var touched = DB.writes.some(function (x) { return /^(calls|visits)\//.test(x.path); });
    var w = flushWrites_();
    if (touched) w.then(kick_, function () {});
    w.catch(function (err) {
      console.error(err);
      if (typeof toast === 'function') toast('השמירה בשרת נכשלה: ' + (err && err.code === 'permission-denied' ? 'אין הרשאה' : (err && err.message || err)), true);
    });
    return r;
  });
}
