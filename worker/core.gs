/**
 * MTI שירות – לוגיקה משותפת (דפדפן + Apps Script worker).
 * שכבת הנתונים מוגדרת בנפרד בכל סביבה: read_, find_, append_, update_, settings_, setSetting_,
 * withLock_, now_, today_, uid10_, visitsOf_, resetCache_, saveFile_.
 */

var TZ = 'Asia/Jerusalem';
var APP_NAME = 'MTI שירות';

var PRODUCTS = ['ספא', 'בריכת זרמים', 'סאונה'];
var CALL_TYPES = ['התקנה', 'תקלה', 'חלק', 'הפעלה', 'בדיקת שטח'];
// סוגים שאין להם שורות משלהם בטבלת ההתאמה / המחירון משתמשים בשורות של תקלה
var TYPE_FALLBACK = { 'הפעלה': 'תקלה', 'בדיקת שטח': 'תקלה' };
var TASK = 'משימה';   // callType של משימה (לא קריאת שירות): להביא כסף, טסט לרכב, לאסוף משהו
var TASK_KINDS = ['להביא כסף', 'טסט לרכב', 'לאסוף / להביא ציוד', 'איסוף עצמי', 'אחר'];
/** משימת "איסוף עצמי": לקוח מגיע לאסוף ג'קוזי בעצמו. רק לרישום ביומן, בלי טכנאי */
function isSelfPickup_(c) { return isTask_(c) && /^איסוף עצמי/.test(String(c.description || '')); }
function isTask_(c) { return c && c.callType === TASK; }
var LEVELS = ['מועדף', 'ראשי', 'פשוטה בלבד', 'בעומס', 'חירום'];
var STATUSES = ['נפתחה', 'לתיאום מחדש', 'שובצה', 'תואם מועד', 'ממתין לחלק / ביקור נוסף', 'חלק נשלח ללקוח', 'נסגרה', 'בוטלה'];
var OPEN_STATUSES = ['נפתחה', 'לתיאום מחדש', 'שובצה', 'תואם מועד', 'ממתין לחלק / ביקור נוסף', 'חלק נשלח ללקוח'];
var PAY_METHODS = ['ללא תשלום', 'מסוף אשראי', 'אשראי דרך המשרד', 'מזומן'];
var OUTCOMES = ['הושלם', 'ממתין לחלק', 'נדרש ביקור נוסף'];

var SCHEMA = {
  users: { tab: 'משתמשים', cols: [
    ['id', 'מזהה'], ['name', 'שם'], ['role', 'תפקיד'], ['code', 'קוד כניסה'],
    ['kind', 'פנימי/חיצוני'], ['regions', 'אזורים שלו (מופרד בפסיק)'], ['active', 'פעיל'], ['email', 'מייל'], ['lastSeen', 'כניסה אחרונה'], ['calId', 'יומן Google'], ['phone', 'טלפון']] },
  match: { tab: 'התאמה', cols: [['userId', 'איש צוות'], ['product', 'מוצר'], ['callType', 'סוג קריאה'], ['level', 'רמה']] },
  prices: { tab: 'מחירון חיצוניים', cols: [['userId', 'מתקין'], ['product', 'מוצר'], ['callType', 'סוג קריאה'], ['price', 'מחיר']] },
  customers: { tab: 'לקוחות', cols: [
    ['id', 'מזהה'], ['name', 'שם'], ['phone', 'טלפון'], ['address', 'כתובת'], ['city', 'יישוב'],
    ['region', 'אזור'], ['type', 'סוג לקוח'], ['createdAt', 'נוצר']] },
  calls: { tab: 'קריאות', cols: [
    ['id', 'מספר'], ['createdAt', 'נפתחה'], ['createdBy', 'נפתחה ע"י'], ['customerId', 'לקוח'],
    ['product', 'מוצר'], ['callType', 'סוג קריאה'], ['customerType', 'סוג לקוח'], ['region', 'אזור'],
    ['urgent', 'דחוף'], ['urgentReason', 'סיבת דחיפות'], ['warranty', 'באחריות'], ['simple', 'תקלה פשוטה'],
    ['description', 'תיאור'], ['status', 'סטטוס'],
    ['suggestedUser', 'הצעת המערכת'], ['suggestedDate', 'תאריך מוצע'], ['suggestReason', 'סיבת ההצעה'],
    ['assignedUser', 'משובץ'], ['overrideReason', 'סיבת שינוי שיבוץ'],
    ['date', 'תאריך ביקור'], ['time', 'שעה'], ['agreedPrice', 'מחיר שסוכם עם חיצוני'],
    ['updatedAt', 'עודכנה'], ['closedAt', 'נסגרה'], ['notes', 'הערות'], ['endTime', 'שעת סיום'], ['calEventId', 'אירוע ביומן'], ['calOwner', 'יומן של'],
    ['place', 'מקום (משימה)'], ['contactPhone', 'טלפון איש קשר (משימה)'], ['expectAmount', 'סכום לאיסוף (משימה)'],
    ['pickup', 'איסוף מהמפעל'], ['pickupNote', 'מה לאסוף מהמפעל'],
    ['gEventId', 'אירוע ביומן שירות ספא'], ['gSeen', 'מועד אחרון ביומן גוגל'], ['gText', 'תוכן אחרון ביומן גוגל'], ['gAdopted', 'אירוע מקורי מהיומן'],
    ['visitPrice', 'מחיר ביקור ללקוח (כולל מע"מ, בלי חלקים)']] },
  visits: { tab: 'ביקורים', cols: [
    ['id', 'מזהה'], ['callId', 'קריאה'], ['userId', 'איש צוות'], ['at', 'מועד דיווח'], ['outcome', 'תוצאה'],
    ['work', 'מה בוצע'], ['parts', 'חלקים'], ['photos', 'תמונות'], ['signature', 'חתימה'],
    ['amount', 'סכום שנגבה'], ['payMethod', 'אמצעי תשלום'],
    ['invoiceAt', 'חשבונית הופקה'], ['invoiceBy', 'חשבונית ע"י'],
    ['cashAt', 'מזומן הגיע למשרד'], ['cashBy', 'מזומן התקבל ע"י'],
    ['receiptAt', 'קבלה הופקה'], ['receiptBy', 'קבלה ע"י'], ['notDone', 'מה לא בוצע / נשאר']] },
  log: { tab: 'יומן שינויים', cols: [['at', 'מתי'], ['userId', 'מי'], ['callId', 'קריאה'], ['action', 'פעולה'], ['details', 'פרטים'], ['reason', 'סיבה']] },
  settings: { tab: 'הגדרות', cols: [['key', 'מפתח'], ['value', 'ערך'], ['note', 'הסבר']] },
  alerts: { tab: 'התראות', cols: [['at', 'מתי'], ['key', 'מזהה'], ['callId', 'קריאה'], ['userId', 'למי'], ['type', 'סוג'], ['to', 'טלפון'], ['result', 'תוצאה']] },
  oldcal: { tab: 'היסטוריית יומן', cols: [['key', 'מזהה'], ['start', 'התחלה'], ['end', 'סיום'], ['title', 'כותרת'], ['location', 'מיקום'], ['description', 'תיאור'], ['calendar', 'יומן'], ['color', 'צבע']] }
};

var DEFAULT_SETTINGS = [
  ['regions', 'צפון,חיפה והקריות,שרון,מרכז,ירושלים והסביבה,שפלה,דרום,ערבה ואילת', 'רשימת האזורים, מופרדים בפסיק'],
  ['distance_fee', '300', 'תוספת מרחק למתקין חיצוני מחוץ לאזור שלו (₪)'],
  ['day_units', '4', 'קיבולת יומית של איש שירות פנימי (ביחידות)'],
  ['units', 'ספא|התקנה=3;בריכת זרמים|התקנה=4;בריכת זרמים|תקלה=2', 'כמה יחידות לוקח כל סוג עבודה (ברירת מחדל 1)'],
  ['window_regular', '7', 'בכמה ימי עבודה קדימה מחפשים מקום לפנימיים בקריאה רגילה'],
  ['window_urgent', '2', 'בכמה ימי עבודה קדימה מחפשים מקום לפנימיים בקריאה דחופה'],
  ['workdays', '0,1,2,3,4', 'ימי עבודה (0=ראשון ... 5=שישי)'],
  ['stuck_days', '5', 'אחרי כמה ימי עבודה בלי שינוי קריאה נחשבת תקועה'],
  ['cash_days', '3', 'אחרי כמה ימים מזומן שלא הגיע למשרד מתריע'],
  ['summary_emails', 'MTI.meirs@gmail.com', 'מי מקבל את הסיכום היומי המלא (מופרד בפסיק)'],
  ['kobi_emails', 'Mti.kobi@gmail.com', 'מי מקבל את סיכום שינויי השיבוץ (מייל של קובי)'],
  ['summary_hour', '17', 'שעת הסיכום היומי'],
  ['files_folder', '', 'תיקיית Drive לתמונות וחתימות (נוצרת אוטומטית)'],
  ['next_call_id', '1001', 'מספר הקריאה הבא'],
  ['cal_sync', 'כן', 'להעתיק ביקורים ליומן Google של כל טכנאי (כן/לא)'],
  ['wa_endpoint', '', 'כתובת נקודת הקצה של בוט הוואטסאפ לשליחת התראות'],
  ['wa_key', '', 'המפתח הסודי של הבוט (להדביק ידנית)'],
  ['wa_alerts', 'כן', 'לשלוח לטכנאים התראות בוואטסאפ (כן/לא)'],
  ['remind_min', '60', 'כמה דקות לפני ביקור לשלוח תזכורת'],
  ['late_min', '15', 'כמה דקות לפני ביקור לבדוק אם הקודם עוד פתוח']
];

function log_(userId, callId, action, details, reason) {
  append_('log', { at: now_(), userId: userId, callId: callId || '', action: action, details: details || '', reason: reason || '' });
}

function normName_(s) { return String(s || '').replace(/[\s'"׳]/g, '').trim(); }

function publicUser_(u) { return { id: u.id, name: u.name, role: u.role, kind: u.kind }; }

function isStaff_(me) { return ['admin', 'manager', 'office'].indexOf(me.role) >= 0; }
function need_(cond) { if (!cond) throw new Error('אין הרשאה לפעולה הזו'); }

/* ===================== Pure logic (testable) ===================== */

function list_(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String); }

function parseDate_(s) { var p = String(s).slice(0, 10).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function fmtDate_(d) { return d.toISOString().slice(0, 10); }
function addDays_(s, n) { var d = parseDate_(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate_(d); }
function dow_(s) { return parseDate_(s).getUTCDay(); }

function isWorkday_(s, settings) { return list_(settings.workdays || '0,1,2,3,4').indexOf(String(dow_(s))) >= 0; }

/** n ימי עבודה החל מ-from (כולל from אם הוא יום עבודה) */
function nextWorkdays_(from, n, settings) {
  var out = [], d = from, guard = 0;
  while (out.length < n && guard++ < 400) { if (isWorkday_(d, settings)) out.push(d); d = addDays_(d, 1); }
  return out;
}

function workdaysBetween_(fromDate, toDate, settings) {
  var n = 0, d = addDays_(fromDate, 1), guard = 0;
  while (d <= toDate && guard++ < 2000) { if (isWorkday_(d, settings)) n++; d = addDays_(d, 1); }
  return n;
}

/** מוצרים בקריאה: "ספא + בריכת זרמים" → ['ספא', 'בריכת זרמים'] */
function prods_(product) { return String(product || '').split(' + ').map(function (x) { return x.trim(); }).filter(String); }

/** קריאה עם כמה מוצרים: יחידות = הגבוה מביניהם */
function unitsFor_(product, callType, settings) {
  var ps = prods_(product);
  if (ps.length > 1) return Math.max.apply(null, ps.map(function (p) { return unitsOne_(p, callType, settings); }));
  return unitsOne_(product, callType, settings);
}

function unitsOne_(product, callType, settings) {
  var map = {};
  String(settings.units || '').split(';').forEach(function (p) {
    var kv = p.split('='); if (kv.length === 2) map[kv[0].trim()] = Number(kv[1]);
  });
  return map[product + '|' + callType] || 1;
}

/** כמה מוצרים: הטכנאי צריך להתאים לכולם, והרמה היא החלשה מביניהם */
function levelFor_(ctx, userId, product, callType) {
  var ps = prods_(product);
  if (ps.length < 2) return levelOne_(ctx, userId, product, callType);
  var worst = '', wi = -1;
  for (var k = 0; k < ps.length; k++) {
    var l = levelOne_(ctx, userId, ps[k], callType);
    if (!l) return '';
    var li = LEVELS.indexOf(l);
    if (li > wi) { wi = li; worst = l; }
  }
  return worst;
}

function levelOne_(ctx, userId, product, callType) {
  for (var i = 0; i < ctx.match.length; i++) {
    var m = ctx.match[i];
    if (m.userId === userId && m.product === product && m.callType === callType) return m.level;
  }
  var fb = TYPE_FALLBACK[callType];
  if (fb && !ctx.match.some(function (m) { return m.callType === callType; })) return levelOne_(ctx, userId, product, fb);
  return '';
}

/** כמה מוצרים: סכום המחירים (אם לאחד אין מחיר – אין מחיר) */
function priceFor_(ctx, userId, product, callType) {
  var ps = prods_(product);
  if (ps.length < 2) return priceOne_(ctx, userId, product, callType);
  var sum = 0;
  for (var k = 0; k < ps.length; k++) { var pr = priceOne_(ctx, userId, ps[k], callType); if (pr === null) return null; sum += pr; }
  return sum;
}

function priceOne_(ctx, userId, product, callType) {
  for (var i = 0; i < ctx.prices.length; i++) {
    var p = ctx.prices[i];
    if (p.userId === userId && p.product === product && p.callType === callType && String(p.price) !== '') return Number(p.price);
  }
  var fb = TYPE_FALLBACK[callType];
  if (fb && !ctx.prices.some(function (m) { return m.callType === callType; })) return priceOne_(ctx, userId, product, fb);
  return null;
}

function dayLoad_(ctx, userId, date, exceptCallId) {
  var units = 0, regions = [], hasInstall = false;
  ctx.calls.forEach(function (c) {
    if (c.assignedUser !== userId || c.date !== date || String(c.id) === String(exceptCallId)) return;
    if (OPEN_STATUSES.indexOf(c.status) < 0 || c.status === 'חלק נשלח ללקוח') return;
    units += unitsFor_(c.product, c.callType, ctx.settings);
    regions.push(c.region);
    if (c.callType === 'התקנה') hasInstall = true;
  });
  return { units: units, regions: regions, hasInstall: hasInstall };
}

var DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function dayLabel_(s) { var p = s.split('-'); return 'יום ' + DAY_NAMES[dow_(s)] + ' ' + (+p[2]) + '/' + (+p[1]); }
function money_(n) { return Number(n).toLocaleString('en-US') + ' ₪'; }

/**
 * הצעת שיבוץ. call: {id, product, callType, simple, region, urgent}
 * ctx: {users, match, prices, calls, settings, today}
 * מחזיר {userId, date, reason, cost} או null.
 */
function suggest_(call, ctx) {
  var s = ctx.settings;
  var dayCap = Number(s.day_units || 4);
  var need = unitsFor_(call.product, call.callType, s);
  var isYes = function (v) { return v === true || v === 'כן'; };
  var simple = isYes(call.simple), urgent = isYes(call.urgent);
  var users = ctx.users.filter(function (u) { return u.role === 'tech' && u.active !== 'לא'; });
  var nameOf = function (id) { var u = users.filter(function (x) { return x.id === id; })[0]; return u ? u.name : id; };
  // קריאה רגילה מתחילה ממחר; דחופה כבר מהיום
  var start = urgent ? ctx.today : addDays_(ctx.today, 1);
  var windowDays = nextWorkdays_(start, Number(urgent ? s.window_urgent || 2 : s.window_regular || 7), s);

  // --- פנימיים: ממלאים להם את היום ---
  var internals = users.filter(function (u) { return u.kind === 'פנימי'; });
  function internalOptions(days) {
    var opts = [];
    internals.forEach(function (u) {
      var lvl = levelFor_(ctx, u.id, call.product, call.callType);
      if (!lvl || lvl === 'בעומס' || lvl === 'חירום') return;
      days.forEach(function (d, idx) {
        var load = dayLoad_(ctx, u.id, d, call.id);
        if (load.units + need > dayCap) return;
        var sameRegion = !!call.region && load.regions.indexOf(call.region) >= 0;
        if (lvl === 'פשוטה בלבד' && !simple && !(load.hasInstall && sameRegion)) return;
        var score = idx - (sameRegion ? (urgent ? 0.5 : 3) : 0) - (lvl === 'מועדף' ? 1 : 0);
        opts.push({ u: u, d: d, lvl: lvl, sameRegion: sameRegion, score: score, nearInstall: lvl === 'פשוטה בלבד' && !simple });
      });
    });
    opts.sort(function (a, b) { return a.score - b.score || (a.d < b.d ? -1 : 1); });
    return opts;
  }
  function internalResult(o, prefix) {
    var why = [];
    if (o.lvl === 'מועדף') why.push(o.u.name + ' מועדף ל' + (call.callType === 'התקנה' ? 'התקנות' : call.callType));
    if (o.nearInstall) why.push('יש לו התקנה באותו אזור באותו יום');
    else if (o.lvl === 'פשוטה בלבד') why.push('תקלה פשוטה');
    if (o.sameRegion) why.push('מצטרף לקריאה אחרת שלו באזור ' + call.region);
    return { userId: o.u.id, date: o.d, cost: 0,
      reason: (prefix || '') + o.u.name + ' (בשכר) פנוי ב' + dayLabel_(o.d) + (why.length ? '. ' + why.join(', ') : '') };
  }

  var inWin = internalOptions(windowDays);
  if (inWin.length) return internalResult(inWin[0]);

  // --- חיצוניים: הזול מנצח ---
  var rank = { 'מועדף': 0, 'ראשי': 0, 'בעומס': 1, 'חירום': 2 };
  var fee = Number(s.distance_fee || 0);
  var ext = [];
  users.filter(function (u) { return u.kind === 'חיצוני'; }).forEach(function (u) {
    var lvl = levelFor_(ctx, u.id, call.product, call.callType);
    if (!lvl || !rank.hasOwnProperty(lvl)) return;
    var base = priceFor_(ctx, u.id, call.product, call.callType);
    var inArea = !call.region || list_(u.regions).indexOf(call.region) >= 0;
    var cost = base === null ? null : base + (inArea ? 0 : fee);
    ext.push({ u: u, lvl: lvl, r: rank[lvl], cost: cost, base: base, inArea: inArea });
  });
  ext.sort(function (a, b) {
    if (a.r !== b.r) return a.r - b.r;
    var ca = a.cost === null ? 1e12 : a.cost, cb = b.cost === null ? 1e12 : b.cost;
    return ca - cb;
  });
  var noRoom = 'אין מקום לפנימיים ב-' + windowDays.length + ' ימי העבודה הקרובים. ';
  if (!internals.some(function (u) { var l = levelFor_(ctx, u.id, call.product, call.callType); return l && l !== 'בעומס' && l !== 'חירום'; })) noRoom = '';
  if (ext.length) {
    var e = ext[0];
    var costTxt = e.cost === null ? 'אין מחיר קבוע, לרשום מחיר שסוכם' :
      money_(e.cost) + (e.inArea ? '' : ' (כולל תוספת מרחק ' + money_(fee) + ')');
    var alt = ext[1] && ext[1].r === e.r && ext[1].cost !== null && e.cost !== null ? '. ' + ext[1].u.name + ': ' + money_(ext[1].cost) : '';
    var lvlTxt = e.lvl === 'חירום' ? ' (רק כשאין ברירה)' : e.lvl === 'בעומס' ? ' (עוזר בעומס)' : '';
    return { userId: e.u.id, date: '', cost: e.cost === null ? '' : e.cost,
      reason: noRoom + e.u.name + lvlTxt + ': ' + costTxt + alt };
  }

  // --- אין חיצוני (למשל בריכת זרמים): מחכים לפנימי ביום הפנוי הראשון ---
  var later = internalOptions(nextWorkdays_(start, 60, s));
  if (later.length) {
    later.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.score - b.score; });
    var only = internals.filter(function (u) { return levelFor_(ctx, u.id, call.product, call.callType); }).length === 1;
    return internalResult(later[0], only ? call.product + ': רק ' + later[0].u.name + ', מחכים לו. ' : 'אין מקום בימים הקרובים. ');
  }
  return null;
}

function isStuck_(call, settings, today) {
  if (OPEN_STATUSES.indexOf(call.status) < 0 || call.status === 'חלק נשלח ללקוח') return false;
  var last = String(call.updatedAt || call.createdAt).slice(0, 10);
  if (!last) return false;
  return workdaysBetween_(last, today, settings) >= Number(settings.stuck_days || 5);
}

function daysSince_(stamp, today) {
  return Math.round((parseDate_(today) - parseDate_(String(stamp).slice(0, 10))) / 86400000);
}

/* ===================== Helpers ===================== */

function ctx_() {
  return { users: read_('users'), match: read_('match'), prices: read_('prices'), calls: read_('calls'), settings: settings_(), today: today_() };
}

function userName_(id) { if (id === 'gcal') return 'יומן גוגל'; var u = find_('users', id); return u ? u.name : (id || ''); }

function callView_(c, me) {
  var cust = find_('customers', c.customerId) || {};
  var s = settings_();
  var v = {};
  for (var k in c) if (k !== '_row') v[k] = c[k];
  v.customer = { id: cust.id, name: cust.name, phone: cust.phone, address: cust.address, city: cust.city, region: cust.region, type: cust.type };
  v.isTask = isTask_(c);
  if (v.isTask) v.customer = { name: taskTitle_(c), phone: c.contactPhone, address: c.place, city: '' };
  v.assignedName = userName_(c.assignedUser);
  v.suggestedName = userName_(c.suggestedUser);
  v.createdByName = userName_(c.createdBy);
  v.stuck = isStuck_(c, s, today_());
  v.units = unitsFor_(c.product, c.callType, s);
  v.isNew = false;
  if (me && me.role === 'tech') {
    // טכנאי לא רואה סיבות שיבוץ ומחירים פנימיים
    delete v.suggestReason; delete v.overrideReason; delete v.suggestedUser; delete v.suggestedName; delete v.suggestedDate;
    if (me.kind !== 'חיצוני') delete v.agreedPrice;
  }
  return v;
}

/** כותרת קצרה למשימה (שורה ראשונה של התיאור) */
function taskTitle_(c) { var t = String(c.description || '').split('\n')[0]; return t.length > 60 ? t.slice(0, 58) + '…' : t; }

/** שם / מקום / טלפון לתצוגה ברשימות: לקוח בקריאה, תיאור המשימה במשימה */
function who_(c, cu) {
  if (isTask_(c)) return { name: taskTitle_(c), city: '', phone: c.contactPhone || '', address: c.place || '' };
  cu = cu || {};
  return { name: cu.name || '', city: cu.city || '', phone: cu.phone || '', address: cu.address || '' };
}

function canSeeCall_(me, c) {
  if (isStaff_(me)) return true;
  if (me.role === 'tech') return c.assignedUser === me.id;
  return false;
}

function checkTimes_(t, e) {
  if (e && !t) throw new Error('יש לבחור שעת התחלה');
  if (t && e && e <= t) throw new Error('שעת הסיום צריכה להיות אחרי שעת ההתחלה');
}

function getCall_(id) { var c = find_('calls', id); if (!c) throw new Error('קריאה לא נמצאה'); return c; }

function touch_(c, patch) { patch.updatedAt = now_(); update_('calls', c._row, patch); }

/* ===================== Actions ===================== */

var ACTIONS = {};

ACTIONS.init = function (me) {
  var s = settings_();
  var users = read_('users').filter(function (u) { return u.active !== 'לא'; }).map(publicUser_);
  return {
    me: publicUser_(me), users: users, regions: list_(s.regions), products: PRODUCTS, callTypes: CALL_TYPES,
    statuses: STATUSES, payMethods: PAY_METHODS, outcomes: OUTCOMES, taskKinds: TASK_KINDS, today: today_(),
    workdays: list_(s.workdays).map(Number), cashDays: Number(s.cash_days || 3)
  };
};

/* ---- קריאות ---- */

ACTIONS.listCalls = function (me, p) {
  var s = settings_(), today = today_();
  var calls = read_('calls').filter(function (c) { return canSeeCall_(me, c); });
  if (p.scope === 'open') calls = calls.filter(function (c) { return OPEN_STATUSES.indexOf(c.status) >= 0; });
  if (p.scope === 'closed') calls = calls.filter(function (c) { return OPEN_STATUSES.indexOf(c.status) < 0; }).slice(-200);
  var custs = {}; read_('customers').forEach(function (x) { custs[x.id] = x; });
  return calls.map(function (c) {
    var w = who_(c, custs[c.customerId]);
    return { id: c.id, createdAt: c.createdAt, product: c.product, callType: c.callType, status: c.status,
      urgent: c.urgent, warranty: c.warranty, region: c.region, date: c.date, time: c.time, endTime: c.endTime,
      assignedUser: c.assignedUser, assignedName: userName_(c.assignedUser), customerName: w.name,
      city: w.city, phone: w.phone, address: w.address, description: c.description, isTask: isTask_(c), expectAmount: c.expectAmount, pickup: c.pickup,
      stuck: isStuck_(c, s, today), updatedAt: c.updatedAt };
  }).sort(function (a, b) {
    if ((a.urgent === 'כן') !== (b.urgent === 'כן')) return a.urgent === 'כן' ? -1 : 1;
    return Number(a.id) - Number(b.id);
  });
};

ACTIONS.getCall = function (me, p) {
  var c = getCall_(p.id);
  need_(canSeeCall_(me, c) || me.role === 'billing');
  var v = callView_(c, me);
  v.visits = visitsOf_(c.id).map(visitView_);
  if (isStaff_(me)) {
    v.log = logOf_(c.id).map(function (l) { return { at: l.at, who: userName_(l.userId), action: l.action, details: l.details, reason: l.reason }; });
  }
  if (!c.customerId) v.history = [];
  else if (isStaff_(me)) {
    v.history = read_('calls').filter(function (x) { return x.customerId === c.customerId && String(x.id) !== String(c.id); })
      .map(function (x) { return { id: x.id, createdAt: x.createdAt, product: x.product, callType: x.callType, status: x.status }; });
  } else if (me.role === 'tech') {
    v.history = read_('calls').filter(function (x) { return x.customerId === c.customerId && String(x.id) !== String(c.id); })
      .map(function (x) { return { id: x.id, createdAt: x.createdAt, product: x.product, callType: x.callType, status: x.status }; });
  }
  return v;
};

function visitView_(x) {
  return { id: x.id, callId: x.callId, userId: x.userId, userName: userName_(x.userId), at: x.at, outcome: x.outcome,
    work: x.work, notDone: x.notDone, parts: x.parts, photos: list_(x.photos), signature: x.signature, amount: x.amount, payMethod: x.payMethod,
    invoiceAt: x.invoiceAt, invoiceBy: userName_(x.invoiceBy), cashAt: x.cashAt, cashBy: userName_(x.cashBy),
    receiptAt: x.receiptAt, receiptBy: userName_(x.receiptBy) };
}

ACTIONS.findCustomers = function (me, p) {
  need_(isStaff_(me));
  var q = String(p.q || '').replace(/[\s-]/g, '');
  if (q.length < 2) return [];
  return read_('customers').filter(function (c) {
    return String(c.phone).replace(/[\s-]/g, '').indexOf(q) >= 0 || String(c.name).replace(/\s/g, '').indexOf(q) >= 0;
  }).slice(0, 10).map(function (c) {
    var open = read_('calls').filter(function (x) { return x.customerId === c.id && OPEN_STATUSES.indexOf(x.status) >= 0; }).length;
    return { id: c.id, name: c.name, phone: c.phone, address: c.address, city: c.city, region: c.region, type: c.type, openCalls: open };
  });
};

ACTIONS.suggestPreview = function (me, p) {
  need_(isStaff_(me));
  return suggest_({ id: '', product: p.product, callType: p.callType, simple: p.simple, urgent: p.urgent, region: p.region }, ctx_());
};

ACTIONS.createCall = function (me, p) {
  need_(isStaff_(me));
  var ps = prods_(p.product);
  if (!ps.length || ps.some(function (x) { return PRODUCTS.indexOf(x) < 0; }) || CALL_TYPES.indexOf(p.callType) < 0) throw new Error('יש לבחור מוצר וסוג קריאה');
  p.product = PRODUCTS.filter(function (x) { return ps.indexOf(x) >= 0; }).join(' + ');
  if (!p.customer || !String(p.customer.name || '').trim() || !String(p.customer.phone || '').trim()) throw new Error('חסר שם או טלפון של הלקוח');
  if (p.warranty !== 'כן' && p.warranty !== 'לא') throw new Error('יש לסמן אם המוצר באחריות');
  if (p.urgent === 'כן' && p.customer.type !== 'עסק' && !String(p.urgentReason || '').trim()) throw new Error('יש לכתוב למה הקריאה דחופה');
  var vprice = p.warranty === 'לא' ? priceStr_(p.visitPrice) : '';
  return withLock_(function () {
    var id = nextCallId_();   // לפני כל כתיבה: בדפדפן זה שומר מספר מהשרת ומריץ שוב
    var cu = p.customer, custId = cu.id;
    var custType = cu.type === 'עסק' ? 'עסק' : 'פרטי';
    if (custId && find_('customers', custId)) {
      var ex = find_('customers', custId);
      update_('customers', ex._row, { name: cu.name, phone: cu.phone, address: cu.address, city: cu.city, region: cu.region, type: custType });
    } else {
      custId = 'C' + uid10_();
      append_('customers', { id: custId, name: cu.name, phone: cu.phone, address: cu.address, city: cu.city, region: cu.region, type: custType, createdAt: now_() });
    }
    var manualUrgent = p.urgent === 'כן' && custType !== 'עסק';
    var call = {
      id: id, createdAt: now_(), createdBy: me.id, customerId: custId, product: p.product, callType: p.callType,
      customerType: custType, region: cu.region || '', urgent: (custType === 'עסק' || p.urgent === 'כן') ? 'כן' : 'לא',
      urgentReason: custType === 'עסק' ? 'לקוח עסקי' : (p.urgentReason || ''), warranty: p.warranty,
      simple: p.simple === 'כן' ? 'כן' : 'לא', description: p.description || '', status: 'נפתחה', updatedAt: now_(), notes: '',
      pickup: p.pickup === 'כן' ? 'כן' : '', pickupNote: p.pickup === 'כן' ? String(p.pickupNote || '').trim() : '',
      visitPrice: vprice
    };
    if (p.partShipped === 'כן') {
      call.status = 'חלק נשלח ללקוח';
      append_('calls', call);
      log_(me.id, id, 'נפתחה', 'חלק נשלח ללקוח, בלי ביקור');
    } else {
      var sug = suggest_(call, ctx_());
      if (sug) { call.suggestedUser = sug.userId; call.suggestedDate = sug.date; call.suggestReason = sug.reason; }
      append_('calls', call);
      log_(me.id, id, 'נפתחה', p.product + ' / ' + p.callType + (sug ? ' · הצעה: ' + userName_(sug.userId) : ''));
    }
    if (manualUrgent) log_(me.id, id, 'סומנה דחופה', 'לקוח פרטי', p.urgentReason);
    return { id: id };
  });
};

/* ---- משימות (לא קריאת שירות): המשרד בוחר טכנאי, מועד ומשך ---- */

ACTIONS.createTask = function (me, p) {
  need_(isStaff_(me));
  var text = String(p.description || '').trim();
  if (!text) throw new Error('יש לכתוב מה צריך לעשות');
  var self = /^איסוף עצמי/.test(text);
  var u = p.userId ? find_('users', p.userId) : null;
  if (!self && (!u || u.role !== 'tech')) throw new Error('יש לבחור איש צוות');
  if (u && u.role !== 'tech') throw new Error('יש לבחור איש צוות');
  if (!p.date) throw new Error('יש לבחור תאריך');
  if (!p.time) throw new Error('יש לבחור שעה');
  checkTimes_(p.time, p.endTime);
  var amt = String(p.expectAmount || '').trim();
  if (amt && !(Number(amt) > 0)) throw new Error('סכום לא תקין');
  var id = withLock_(function () {
    var id = nextCallId_();
    var end = p.endTime || fmtMin_(Math.min(toMinS_(p.time) + 60, 23 * 60 + 59));
    append_('calls', {
      id: id, createdAt: now_(), createdBy: me.id, customerId: '', product: '', callType: TASK, customerType: '', region: '',
      urgent: 'לא', urgentReason: '', warranty: '', simple: '', description: text, status: 'תואם מועד',
      suggestedUser: u ? u.id : '', suggestedDate: '', suggestReason: u ? 'משימה. המשרד בחר את ' + u.name : 'איסוף עצמי ע"י הלקוח – בלי טכנאי',
      assignedUser: u ? u.id : '', date: p.date, time: p.time, endTime: end, updatedAt: now_(), notes: '',
      place: String(p.place || '').trim(), contactPhone: String(p.contactPhone || '').trim(), expectAmount: amt
    });
    log_(me.id, id, 'משימה נפתחה', (u ? u.name : 'איסוף עצמי') + ' · ' + p.date + ' ' + p.time + '–' + end + ' · ' + taskTitle_({ description: text }));
    return id;
  });
  return { id: id };
};

/** הטכנאי מסמן: בוצע / לא בוצע. לא בוצע = חוזר למשרד לתיאום מחדש */
ACTIONS.taskDone = function (me, p) {
  var c0 = getCall_(p.id);
  if (!isTask_(c0)) throw new Error('זו לא משימה');
  need_(isStaff_(me) || (me.role === 'tech' && c0.assignedUser === me.id));
  var done = p.done === 'כן';
  var note = String(p.note || '').trim();
  if (!done && !note) throw new Error('יש לכתוב למה לא בוצע');
  var amount = String(p.amount || '').trim();
  if (amount && !(Number(amount) > 0)) throw new Error('סכום לא תקין');
  if (done && c0.expectAmount && !amount) throw new Error('יש לרשום כמה כסף נאסף (או 0 אם לא נאסף כלום)');
  if (Number(amount) === 0) amount = '';
  return withLock_(function () {
    var c = getCall_(p.id);
    if (OPEN_STATUSES.indexOf(c.status) < 0) throw new Error('המשימה כבר סגורה');
    append_('visits', { id: 'V' + uid10_(), callId: c.id, userId: me.id, at: now_(),
      outcome: done ? 'בוצע' : 'לא בוצע', work: done ? note : '', notDone: done ? '' : note,
      amount: amount, payMethod: amount ? 'מזומן' : '' });
    var patch = done ? { status: 'נסגרה', closedAt: now_() } : { status: 'לתיאום מחדש', date: '', time: '', endTime: '' };
    touch_(c, patch);
    log_(me.id, c.id, done ? 'משימה בוצעה' : 'משימה לא בוצעה', amount ? 'נאספו ' + money_(amount) + ' במזומן' : '', done ? '' : note);
    return { ok: true };
  });
};

/** מחיר שהוקלד ('350', '350 ש"ח') → '350'. ריק = אין מחיר */
function priceStr_(v) {
  var t = String(v === undefined || v === null ? '' : v).replace(/[^\d.]/g, '');
  if (!t) return '';
  if (!(Number(t) > 0)) throw new Error('מחיר ביקור לא תקין');
  return String(Number(t));
}

function fmtMin_(m) { var hh = Math.floor(m / 60), mm = m % 60; return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }

ACTIONS.updateCallInfo = function (me, p) {
  need_(isStaff_(me));
  return withLock_(function () {
    var c = getCall_(p.id), patch = {}, changes = [];
    if (p.hasOwnProperty('visitPrice')) p.visitPrice = priceStr_(p.visitPrice);
    ['description', 'warranty', 'simple', 'notes', 'agreedPrice', 'place', 'contactPhone', 'expectAmount', 'pickup', 'pickupNote', 'visitPrice'].forEach(function (k) {
      if (p.hasOwnProperty(k) && String(p[k]) !== String(c[k])) { patch[k] = p[k]; changes.push(k); }
    });
    // מוצר / סוג קריאה (רחלי טעתה בפתיחה)
    if (p.hasOwnProperty('product') && !isTask_(c)) {
      var ps = prods_(p.product);
      if (!ps.length || ps.some(function (x) { return PRODUCTS.indexOf(x) < 0; })) throw new Error('יש לבחור מוצר');
      var prod = PRODUCTS.filter(function (x) { return ps.indexOf(x) >= 0; }).join(' + ');
      if (prod !== c.product) { patch.product = prod; changes.push('product'); }
    }
    if (p.hasOwnProperty('callType') && !isTask_(c) && p.callType !== c.callType) {
      if (CALL_TYPES.indexOf(p.callType) < 0) throw new Error('סוג קריאה לא תקין');
      patch.callType = p.callType; changes.push('callType');
    }
    // פרטי הלקוח
    var cu = !isTask_(c) && c.customerId ? find_('customers', c.customerId) : null;
    if (cu && p.customer) {
      var cp = {}, cch = [];
      ['name', 'phone', 'address', 'city', 'region', 'type'].forEach(function (k) {
        if (p.customer.hasOwnProperty(k) && String(p.customer[k] || '').trim() !== String(cu[k] || '')) { cp[k] = String(p.customer[k] || '').trim(); cch.push(k); }
      });
      if (cp.hasOwnProperty('name') && !cp.name) throw new Error('חסר שם לקוח');
      if (cp.hasOwnProperty('phone') && !cp.phone) throw new Error('חסר טלפון');
      if (cch.length) {
        update_('customers', cu._row, cp);
        if (cp.hasOwnProperty('region')) patch.region = cp.region;
        if (cp.hasOwnProperty('type')) { patch.customerType = cp.type; if (cp.type === 'עסק') { patch.urgent = 'כן'; patch.urgentReason = 'לקוח עסקי'; } }
        changes.push('customer');
      }
    }
    if (p.hasOwnProperty('urgent') && p.urgent !== c.urgent && !(patch.customerType === 'עסק')) {
      if (p.urgent === 'כן' && c.customerType !== 'עסק') {
        if (!String(p.urgentReason || '').trim()) throw new Error('יש לכתוב למה הקריאה דחופה');
        log_(me.id, c.id, 'סומנה דחופה', '', p.urgentReason);
      }
      if (p.urgent === 'לא' && (patch.customerType || c.customerType) === 'עסק') throw new Error('לקוח עסקי תמיד דחוף');
      patch.urgent = p.urgent; patch.urgentReason = p.urgent === 'כן' ? p.urgentReason : '';
      changes.push('urgent');
    }
    if (!changes.length) return { ok: true };
    touch_(c, patch);
    // מוצר / סוג / אזור השתנו וטרם שובץ – מחשבים הצעה מחדש
    if ((patch.product || patch.callType || patch.region) && !c.assignedUser && !isTask_(c)) {
      resetCache_();
      var c2 = getCall_(c.id), sug = suggest_(c2, ctx_());
      update_('calls', c2._row, { suggestedUser: sug ? sug.userId : '', suggestedDate: sug ? sug.date : '', suggestReason: sug ? sug.reason : 'אין איש צוות מתאים' });
    }
    log_(me.id, c.id, 'עודכנו פרטים', changes.map(function (k) { return ({ product: 'מוצר', callType: 'סוג קריאה', customer: 'פרטי לקוח', description: 'תיאור', warranty: 'אחריות', simple: 'תקלה פשוטה', notes: 'הערות', agreedPrice: 'מחיר שסוכם', urgent: 'דחיפות', place: 'מקום', contactPhone: 'טלפון', expectAmount: 'סכום לאיסוף', pickup: 'איסוף מהמפעל', pickupNote: 'מה לאסוף', visitPrice: 'מחיר ביקור ללקוח' })[k]; }).join(', '));
    return { ok: true };
  });
};

ACTIONS.resuggest = function (me, p) {
  need_(isStaff_(me));
  return withLock_(function () {
    var c = getCall_(p.id);
    if (isTask_(c)) return null;
    var sug = suggest_(c, ctx_());
    update_('calls', c._row, { suggestedUser: sug ? sug.userId : '', suggestedDate: sug ? sug.date : '', suggestReason: sug ? sug.reason : 'אין איש צוות מתאים' });
    return sug;
  });
};

ACTIONS.assign = function (me, p) {
  need_(isStaff_(me));
  return withLock_(function () {
    var c = getCall_(p.id);
    var u = find_('users', p.userId);
    if (!u || u.role !== 'tech') throw new Error('יש לבחור איש צוות');
    var differs = !isTask_(c) && c.suggestedUser && p.userId !== c.suggestedUser;
    checkTimes_(p.time, p.endTime);
    var patch = { assignedUser: p.userId, date: p.date || '', time: p.time || '', endTime: p.time ? (p.endTime || '') : '' };
    if (differs) patch.overrideReason = p.reason;
    if (p.agreedPrice !== undefined) patch.agreedPrice = p.agreedPrice;
    // חיצוני מחוץ לאחריות: המתקין מתאם בעצמו
    var selfCoord = u.kind === 'חיצוני' && c.warranty === 'לא';
    patch.status = p.date && !selfCoord && p.confirmed ? 'תואם מועד' : 'שובצה';
    if (isTask_(c)) {
      if (!p.date || !p.time) throw new Error('למשימה צריך תאריך ושעה');
      patch.status = 'תואם מועד';
      if (!patch.endTime) patch.endTime = fmtMin_(Math.min(toMinS_(p.time) + 60, 23 * 60 + 59));
      patch.suggestedUser = p.userId;
    }
    touch_(c, patch);
    var prev = c.assignedUser ? userName_(c.assignedUser) + ' ← ' : '';
    log_(me.id, c.id, differs ? 'שיבוץ שונה מההצעה' : 'שובצה', prev + u.name + (differs ? ' (הצעת המערכת: ' + userName_(c.suggestedUser) + ')' : '') + (p.date ? ' · ' + p.date : ''), differs ? p.reason : '');
    return { ok: true };
  });
};

ACTIONS.schedule = function (me, p) {
  return withLock_(function () {
    var c = getCall_(p.id);
    var u = find_('users', c.assignedUser);
    var selfCoord = u && u.kind === 'חיצוני' && c.warranty === 'לא' && me.id === c.assignedUser;
    need_(isStaff_(me) || selfCoord);
    if (!p.date) throw new Error('יש לבחור תאריך');
    checkTimes_(p.time, p.endTime);
    touch_(c, { date: p.date, time: p.time || '', endTime: p.time ? (p.endTime || '') : '', status: 'תואם מועד' });
    log_(me.id, c.id, 'תואם מועד', p.date + (p.time ? ' ' + p.time + (p.endTime ? '–' + p.endTime : '') : ''));
    return { ok: true };
  });
};

/** גרירה ביומן: משנה תאריך / שעה / שעת סיום בלי לגעת בשיבוץ ובסטטוס */
ACTIONS.moveCall = function (me, p) {
  need_(isStaff_(me));
  if (!p.date || !p.time) throw new Error('חסר תאריך או שעה');
  checkTimes_(p.time, p.endTime);
  return withLock_(function () {
    var c = getCall_(p.id);
    if (c.status === 'נסגרה' || c.status === 'בוטלה') throw new Error('אי אפשר להזיז קריאה סגורה');
    var patch = { date: p.date, time: p.time, endTime: p.endTime || '' };
    if (c.status === 'לתיאום מחדש' && (c.assignedUser || isSelfPickup_(c))) patch.status = 'תואם מועד';
    touch_(c, patch);
    log_(me.id, c.id, 'הוזזה ביומן', (c.date ? c.date + ' ' + (c.time || '') + ' ← ' : '') + p.date + ' ' + p.time + (p.endTime ? '–' + p.endTime : ''));
    return { ok: true };
  });
};

ACTIONS.setStatus = function (me, p) {
  need_(isStaff_(me));
  if (['נסגרה', 'בוטלה', 'חלק נשלח ללקוח', 'נפתחה'].indexOf(p.status) < 0) throw new Error('סטטוס לא חוקי');
  return withLock_(function () {
    var c = getCall_(p.id);
    var patch = { status: p.status };
    if (p.status === 'נסגרה' || p.status === 'בוטלה') patch.closedAt = now_();
    if (p.status === 'נפתחה') { patch.assignedUser = ''; patch.date = ''; patch.time = ''; patch.closedAt = ''; }
    touch_(c, patch);
    log_(me.id, c.id, 'סטטוס: ' + p.status, '', p.reason || '');
    return { ok: true };
  });
};

/* ---- הלקוח לא זמין: חוזר לתיאום מול המשרד ---- */

// סיבות מצד הלקוח: השיבוץ נשאר. סיבות מצד הטכנאי: הקריאה יוצאת ממנו ומקבלת הצעת שיבוץ חדשה.
var CUSTOMER_REASONS = ['הלקוח לא עונה', 'הלקוח לא יכול לקבל בזמן הזה', 'הלקוח לא היה במקום'];
var TECH_REASONS = ['לא אספיק להגיע', 'תקלה ברכב', 'חסר חלק או ציוד'];
var UNAVAILABLE_REASONS = CUSTOMER_REASONS.concat(TECH_REASONS, ['אחר']);

ACTIONS.customerUnavailable = function (me, p) {
  var c0 = getCall_(p.id);
  need_(isStaff_(me) || (me.role === 'tech' && c0.assignedUser === me.id));
  if (isTask_(c0)) throw new Error('במשימה מסמנים "לא בוצע"');
  if (UNAVAILABLE_REASONS.indexOf(p.reason) < 0) throw new Error('יש לבחור סיבה');
  if (p.reason === 'אחר' && !String(p.note || '').trim()) throw new Error('יש לכתוב מה קרה');
  return withLock_(function () {
    var c = getCall_(p.id);
    if (OPEN_STATUSES.indexOf(c.status) < 0) throw new Error('הקריאה כבר סגורה');
    var text = p.reason + (p.note ? ' · ' + p.note : '');
    var techSide = TECH_REASONS.indexOf(p.reason) >= 0;
    append_('visits', { id: 'V' + uid10_(), callId: c.id, userId: me.id, at: now_(),
      outcome: techSide ? 'הטכנאי לא הגיע' : 'לקוח לא זמין', work: text, payMethod: '' });
    var patch = { status: 'לתיאום מחדש', date: '', time: '', endTime: '' };
    if (techSide) {
      patch.assignedUser = '';
      var ctx = ctx_(); ctx.calls = ctx.calls.filter(function (x) { return String(x.id) !== String(c.id); });
      var sug = suggest_(c, ctx);
      patch.suggestedUser = sug ? sug.userId : ''; patch.suggestedDate = sug ? sug.date : ''; patch.suggestReason = sug ? sug.reason : 'אין איש צוות מתאים';
    }
    touch_(c, patch);
    log_(me.id, c.id, 'חזר לתיאום', (c.date ? 'היה מתואם ל-' + c.date + (c.time ? ' ' + c.time : '') + ' אצל ' + userName_(c.assignedUser) : ''), text);
    return { ok: true };
  });
};

/* ---- דיווח ביקור ---- */

ACTIONS.report = function (me, p) {
  need_(me.role === 'tech');
  var c = getCall_(p.callId);
  need_(c.assignedUser === me.id);
  if (isTask_(c)) throw new Error('במשימה מסמנים בוצע / לא בוצע');
  var isExt = me.kind === 'חיצוני';
  var selfColl = isExt && c.warranty === 'לא';
  var outcome = selfColl ? 'הושלם' : p.outcome;
  if (OUTCOMES.indexOf(outcome) < 0) throw new Error('יש לבחור תוצאה');
  if (!selfColl && !String(p.work || '').trim()) throw new Error('יש לכתוב מה בוצע');
  if (!selfColl && outcome !== 'הושלם' && !String(p.notDone || '').trim()) throw new Error('יש לכתוב מה לא בוצע / מה נשאר לעשות');
  var amount = '', method = '';
  if (!isExt) {
    method = p.payMethod || 'ללא תשלום';
    if (PAY_METHODS.indexOf(method) < 0) throw new Error('אמצעי תשלום לא מוכר');
    amount = method === 'ללא תשלום' ? '' : String(Number(p.amount || 0));
    if (method !== 'ללא תשלום' && !(Number(amount) > 0)) throw new Error('יש לרשום כמה נגבה');
  }
  // שמירת קבצים מחוץ לנעילה
  var photos = (p.photos || []).slice(0, 8).map(function (d, i) { return saveFile_(d, 'call' + c.id + '_' + me.id + '_' + i + '.jpg', c, me); });
  var sig = p.signature ? saveFile_(p.signature, 'call' + c.id + '_sig.png', c, me) : '';
  return withLock_(function () {
    c = getCall_(p.callId);
    var vid = 'V' + uid10_();
    append_('visits', { id: vid, callId: c.id, userId: me.id, at: now_(), outcome: selfColl ? 'הטיפול הסתיים' : outcome,
      work: p.work || '', parts: p.parts || '', photos: photos.join(','), signature: sig, amount: amount, payMethod: method, notDone: p.notDone || '' });
    var status = outcome === 'הושלם' ? 'נסגרה' : 'ממתין לחלק / ביקור נוסף';
    var patch = { status: status };
    if (status === 'נסגרה') patch.closedAt = now_();
    touch_(c, patch);
    log_(me.id, c.id, 'דיווח ביקור', (selfColl ? 'הטיפול הסתיים' : outcome) + (amount ? ' · נגבו ' + money_(amount) + ' ב' + method : ''));
    return { ok: true, status: status };
  });
};

/* ---- לוח זמנים ---- */

/** מסך הבית של הטכנאי בבקשה אחת (במקום שלוש) */
ACTIONS.techHome = function (me, p) {
  return { wk: ACTIONS.schedule_week(me, { from: p.from }), cash: me.kind !== 'חיצוני' ? ACTIONS.cashInField(me, {}) : [], open: ACTIONS.listCalls(me, { scope: 'open' }) };
};

ACTIONS.schedule_week = function (me, p) {
  var s = settings_();
  var from = p.from || today_();
  var n = Math.max(1, Math.min(42, Number(p.days) || 7));
  var days = []; for (var i = 0; i < n; i++) days.push(addDays_(from, i));
  var to = days[n - 1];
  var custs = {}; read_('customers').forEach(function (x) { custs[x.id] = x; });
  var calls = read_('calls').filter(function (c) {
    return c.date >= from && c.date <= to && canSeeCall_(me, c) && c.status !== 'בוטלה';
  }).map(function (c) {
    var w = who_(c, custs[c.customerId]);
    return { id: c.id, date: c.date, time: c.time, endTime: c.endTime, assignedUser: c.assignedUser, product: c.product, callType: c.callType,
      status: c.status, urgent: c.urgent, customerName: w.name, city: w.city, address: w.address, region: c.region, isTask: isTask_(c), pickup: c.pickup,
      units: unitsFor_(c.product, c.callType, s) };
  });
  var old = [];
  if (isStaff_(me)) old = oldInRange_(from, to);
  var techs = read_('users').filter(function (u) { return u.role === 'tech' && u.active !== 'לא' && (isStaff_(me) || u.id === me.id); })
    .map(function (u) { return { id: u.id, name: u.name, kind: u.kind }; });
  return { days: days, calls: calls, old: old, techs: techs, dayUnits: Number(s.day_units || 4), workdays: list_(s.workdays).map(Number) };
};

/** טווח של אירוע מהיומן הישן: {start, last, allDay, time, endTime} */
function oldSpan_(e) {
  var st = String(e.start), en = String(e.end || '');
  var sDate = st.slice(0, 10), allDay = st.length <= 10;
  var eDate = en.slice(0, 10) || sDate, eTime = en.slice(11, 16);
  if (allDay) {
    var last = eTime === '00:00' || !eTime ? addDays_(eDate, -1) : eDate;
    if (last < sDate) last = sDate;
    return { start: sDate, last: last, allDay: true, time: '', endTime: '' };
  }
  if (eDate > sDate && eTime === '00:00' && addDays_(sDate, 1) === eDate) return { start: sDate, last: sDate, allDay: false, time: st.slice(11, 16), endTime: '24:00' };
  if (eDate > sDate) return { start: sDate, last: eDate, allDay: true, time: st.slice(11, 16), endTime: eTime };
  return { start: sDate, last: sDate, allDay: false, time: st.slice(11, 16), endTime: eTime };
}

/* ---- חיוב ומזומן ---- */

ACTIONS.billing = function (me, p) {
  need_(me.role === 'billing' || me.role === 'admin' || me.role === 'manager');
  var custs = {}; read_('customers').forEach(function (x) { custs[x.id] = x; });
  var calls = {}; read_('calls').forEach(function (x) { calls[x.id] = x; });
  var today = today_();
  var rows = read_('visits').filter(function (v) { return Number(v.amount) > 0; }).map(function (v) {
    var c = calls[v.callId] || {}, w = who_(c, custs[c.customerId]);
    var done = v.invoiceAt && v.receiptAt;
    return { id: v.id, callId: v.callId, at: v.at, userName: userName_(v.userId), amount: v.amount, payMethod: v.payMethod,
      customerName: w.name, phone: w.phone, city: w.city, product: c.product, callType: c.callType, work: v.work, parts: v.parts, isTask: isTask_(c),
      invoiceAt: v.invoiceAt, cashAt: v.cashAt, receiptAt: v.receiptAt, done: !!done,
      cashDays: v.payMethod === 'מזומן' && !v.cashAt ? daysSince_(v.at, today) : null };
  });
  if (p.scope !== 'all') rows = rows.filter(function (r) { return !r.done; });
  else rows = rows.slice(-300);
  return rows.reverse();
};

ACTIONS.billingMark = function (me, p) {
  need_(me.role === 'billing' || me.role === 'admin');
  return withLock_(function () {
    var v = find_('visits', p.id);
    if (!v) throw new Error('ביקור לא נמצא');
    var patch = {};
    if (p.what === 'invoice') { patch.invoiceAt = p.undo ? '' : now_(); patch.invoiceBy = p.undo ? '' : me.id; }
    else if (p.what === 'cash') {
      if (v.payMethod !== 'מזומן') throw new Error('הביקור לא שולם במזומן');
      patch.cashAt = p.undo ? '' : now_(); patch.cashBy = p.undo ? '' : me.id;
    } else if (p.what === 'receipt') {
      if (!p.undo && v.payMethod === 'מזומן' && !v.cashAt) throw new Error('קבלה על מזומן יוצאת רק אחרי שהכסף הגיע למשרד');
      patch.receiptAt = p.undo ? '' : now_(); patch.receiptBy = p.undo ? '' : me.id;
    } else throw new Error('פעולה לא מוכרת');
    update_('visits', v._row, patch);
    var label = { invoice: 'חשבונית הופקה', cash: 'מזומן הגיע למשרד', receipt: 'קבלה הופקה' }[p.what];
    log_(me.id, v.callId, (p.undo ? 'בוטל: ' : '') + label, money_(v.amount) + ' · ' + v.payMethod);
    return { ok: true };
  });
};

ACTIONS.cashInField = function (me) {
  var today = today_();
  var rows = read_('visits').filter(function (v) { return v.payMethod === 'מזומן' && !v.cashAt && Number(v.amount) > 0; });
  if (me.role === 'tech') rows = rows.filter(function (v) { return v.userId === me.id; });
  else need_(isStaff_(me) || me.role === 'billing');
  var byUser = {};
  rows.forEach(function (v) {
    var k = v.userId;
    if (!byUser[k]) byUser[k] = { userId: k, name: userName_(k), total: 0, oldestDays: 0, items: [] };
    var d = daysSince_(v.at, today);
    byUser[k].total += Number(v.amount);
    byUser[k].oldestDays = Math.max(byUser[k].oldestDays, d);
    byUser[k].items.push({ id: v.id, callId: v.callId, at: v.at, amount: Number(v.amount), days: d });
  });
  return Object.keys(byUser).map(function (k) { return byUser[k]; });
};

/* ---- הגדרות (מנהל) ---- */

ACTIONS.adminUsers = function (me) {
  need_(me.role === 'admin');
  return read_('users').map(function (u) { return { id: u.id, name: u.name, role: u.role, kind: u.kind, active: u.active, regions: u.regions, lastSeen: u.lastSeen, email: u.email, hasCal: !!u.calId, phone: u.phone }; });
};

ACTIONS.adminSetActive = function (me, p) {
  need_(me.role === 'admin');
  var u = find_('users', p.id);
  if (!u) throw new Error('משתמש לא נמצא');
  if (u.id === me.id) throw new Error('אי אפשר לחסום את עצמך');
  update_('users', u._row, { active: p.active ? 'כן' : 'לא' });
  setAccess_(u.id, u.email, u.email);
  log_(me.id, '', p.active ? 'משתמש הופעל' : 'משתמש נחסם', u.name);
  return { ok: true };
};

ACTIONS.adminInfo = function (me) {
  need_(me.role === 'admin');
  var s = settings_();
  var waOk = s.wa_ok === 'כן' || !!(s.wa_endpoint && s.wa_key);
  var lastAlerts = read_('alerts').slice(-8).reverse().map(function (a) { return { at: a.at, who: userName_(a.userId), type: a.type, result: a.result }; });
  return { waOk: waOk, lastAlerts: lastAlerts, sheetUrl: s.sheet_url || '', summaryEmails: s.summary_emails, kobiEmails: s.kobi_emails, hour: s.summary_hour,
    calendars: [], oldCount: read_('oldcal').length };
};

/* ---- יומן שירות ---- */

ACTIONS.serviceLog = function (me, p) {
  need_(isStaff_(me));
  var to = p.to || today_(), from = p.from || addDays_(to, -13);
  var q = String(p.q || '').replace(/\s/g, '');
  var custs = {}; read_('customers').forEach(function (x) { custs[x.id] = x; });
  var calls = {}; read_('calls').forEach(function (x) { calls[x.id] = x; });
  var rows = read_('visits').filter(function (v) {
    var d = String(v.at).slice(0, 10);
    if (d < from || d > to) return false;
    if (p.userId && v.userId !== p.userId) return false;
    if (q) {
      var c = calls[v.callId] || {}, w = who_(c, custs[c.customerId]);
      var hay = [v.callId, w.name, w.phone, w.city, c.description].join(' ').replace(/\s/g, '');
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }).map(function (v) {
    var c = calls[v.callId] || {}, w = who_(c, custs[c.customerId]);
    return { id: v.id, callId: v.callId, at: v.at, userName: userName_(v.userId), userId: v.userId, outcome: v.outcome,
      work: v.work, notDone: v.notDone, parts: v.parts, photos: list_(v.photos).length, signed: !!v.signature,
      amount: v.amount, payMethod: v.payMethod, isTask: isTask_(c),
      customerName: w.name, city: w.city, phone: w.phone,
      product: c.product, callType: c.callType, description: c.description, status: c.status,
      openedBy: userName_(c.createdBy), openedAt: c.createdAt };
  });
  rows.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  return { from: from, to: to, rows: rows.slice(0, 300), total: rows.length };
};

/** סוג הביקור במילים (לכותרות) */
function typeLabel_(product, callType) {
  if (callType === 'התקנה') return 'התקנת ' + prods_(product || 'ספא').map(function (p) { return p === 'בריכת זרמים' ? 'בריכה' : p; }).join(' + ');
  if (callType === 'בדיקת שטח') return 'בדיקת שטח';
  if (callType === 'הפעלה') return 'הפעלה ראשונית';
  if (callType === TASK) return 'משימה';
  return 'קריאת שירות';
}

/** סוג + "איסוף מהמפעל" אם מסומן */
function fullLabel_(c) { return typeLabel_(c.product, c.callType) + (c.pickup === 'כן' ? ' + איסוף מהמפעל' : ''); }

function callEventText_(c) {
  if (isTask_(c)) {
    var tl = ['משימה: ' + c.description, c.place ? 'מקום: ' + c.place : '', c.place ? 'ניווט: https://waze.com/ul?q=' + encodeURIComponent(c.place) + '&navigate=yes' : '',
      c.contactPhone ? 'טלפון: ' + c.contactPhone : '', c.expectAmount ? 'לאסוף: ' + money_(c.expectAmount) + ' במזומן' : '', 'סטטוס: ' + c.status].filter(String);
    return { title: (c.status === 'נסגרה' ? '✓ ' : '') + '📌 ' + taskTitle_(c), desc: tl.join('\n'), location: c.place || '' };
  }
  var cu = find_('customers', c.customerId) || {};
  var visits = visitsOf_(c.id);
  var title = (c.urgent === 'כן' ? '❗ ' : '') + (c.status === 'נסגרה' ? '✓ ' : '') + [cu.city, cu.name, fullLabel_(c)].filter(String).join(' · ') + ' #' + c.id;
  var addr = [cu.address, cu.city].filter(String).join(', ');
  var lines = [
    'טלפון: ' + (cu.phone || ''),
    'כתובת: ' + addr,
    addr ? 'ניווט: https://waze.com/ul?q=' + encodeURIComponent(addr) + '&navigate=yes' : '',
    'מוצר: ' + c.product + ' · ' + c.callType + ' · ' + (c.warranty === 'כן' ? 'באחריות' : 'לא באחריות'),
    c.pickup === 'כן' ? 'לאסוף מהמפעל: ' + (c.pickupNote || 'כן') : '',
    c.warranty === 'לא' && c.visitPrice ? 'לגבות מהלקוח: ' + money_(c.visitPrice) + ' לביקור (כולל מע"מ) + חלקים' : '',
    c.description ? 'תיאור: ' + c.description : '',
    'סטטוס: ' + c.status
  ].filter(String);
  if (visits.length) {
    lines.push('', '— דיווחים —');
    visits.forEach(function (v) {
      lines.push(v.at + ' · ' + userName_(v.userId) + ' · ' + v.outcome);
      if (v.work) lines.push('בוצע: ' + v.work);
      if (v.notDone) lines.push('לא בוצע / נשאר: ' + v.notDone);
      if (v.parts) lines.push('חלקים: ' + v.parts);
    });
  }
  return { title: title, desc: lines.join('\n'), location: addr };
}

ACTIONS.adminSetPhone = function (me, p) {
  need_(me.role === 'admin');
  var u = find_('users', p.id);
  if (!u) throw new Error('משתמש לא נמצא');
  var ph = String(p.phone || '').trim();
  if (ph && waPhone_(ph).length < 11) throw new Error('מספר טלפון לא תקין');
  update_('users', u._row, { phone: ph });
  return { ok: true };
};

ACTIONS.adminSetEmail = function (me, p) {
  need_(me.role === 'admin');
  var u = find_('users', p.id);
  if (!u) throw new Error('משתמש לא נמצא');
  var email = String(p.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('כתובת מייל לא תקינה');
  if (email && read_('users').some(function (x) { return x.id !== u.id && String(x.email || '').toLowerCase() === email; })) throw new Error('המייל כבר רשום למשתמש אחר');
  var old = String(u.email || '').toLowerCase();
  // calShare: היומן האישי של טכנאי ישותף למייל החדש ברקע
  update_('users', u._row, { email: email, calShare: email && u.role === 'tech' ? 'pending' : '' });
  setAccess_(u.id, old, email);
  log_(me.id, '', 'מייל עודכן', u.name + ' · ' + (email || 'נמחק'));
  return { ok: true, shared: !!(email && u.role === 'tech') };
};

ACTIONS.adminSaveEmails = function (me, p) {
  need_(me.role === 'admin');
  setSetting_('summary_emails', p.summaryEmails || '');
  setSetting_('kobi_emails', p.kobiEmails || '');
  return { ok: true };
};

var GCAL_COLORS = { '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000' };

/** סיכום לפי טכנאי: כמה התקנות / ביקורים / בדיקות שטח / הפעלות / משימות בטווח תאריכים (לפי מועד הביקור) */
var STAT_COLS = [['install', 'התקנות ספא'], ['pool', 'התקנות בריכה'], ['visit', 'קריאות שירות'], ['site', 'בדיקות שטח'], ['act', 'הפעלות ראשוניות'], ['task', 'משימות']];
function statCol_(c) {
  if (isTask_(c)) return 'task';
  if (c.callType === 'התקנה') return c.product === 'בריכת זרמים' ? 'pool' : 'install';
  return c.callType === 'בדיקת שטח' ? 'site' : c.callType === 'הפעלה' ? 'act' : 'visit';
}
ACTIONS.techStats = function (me, p) {
  need_(isStaff_(me));
  var to = p.to || today_(), from = p.from || (to.slice(0, 8) + '01');
  var techs = read_('users').filter(function (u) { return u.role === 'tech'; });
  var rows = {}, tot = { id: '', name: 'סה"כ', kind: '' };
  techs.forEach(function (u) { rows[u.id] = { id: u.id, name: u.name, kind: u.kind }; });
  var cell = function (r, k) { return r[k] || (r[k] = { done: 0, open: 0 }); };
  read_('calls').forEach(function (c) {
    if (!c.date || c.date < from || c.date > to || !c.assignedUser || c.status === 'בוטלה') return;
    var r = rows[c.assignedUser]; if (!r) return;
    var k = statCol_(c), done = c.status === 'נסגרה';
    cell(r, k)[done ? 'done' : 'open']++; cell(tot, k)[done ? 'done' : 'open']++;
  });
  var list = techs.map(function (u) { return rows[u.id]; }).sort(function (a, b) { return (a.kind === 'פנימי' ? 0 : 1) - (b.kind === 'פנימי' ? 0 : 1); });
  return { from: from, to: to, cols: STAT_COLS, rows: list.concat([tot]) };
};

/** חיפוש ביומן: קריאות ומשימות (עבר ועתיד) + היומן הישן. טכנאי רואה רק את שלו. */
ACTIONS.calSearch = function (me, p) {
  var q = String(p.q || '').trim();
  if (q.length < 2) return { future: [], past: [] };
  var qd = q.replace(/\D/g, ''), qs = q.replace(/\s+/g, ' ');
  var today = today_();
  var hit = function (txt, phones) {
    if (String(txt).replace(/\s+/g, ' ').indexOf(qs) >= 0) return true;
    return qd.length >= 4 && phones.some(function (ph) { return String(ph || '').replace(/\D/g, '').indexOf(qd) >= 0; });
  };
  var custs = {}; read_('customers').forEach(function (x) { custs[x.id] = x; });
  var out = [];
  read_('calls').forEach(function (c) {
    if (!canSeeCall_(me, c)) return;
    var cu = custs[c.customerId] || {}, w = who_(c, cu);
    var txt = ['#' + c.id, c.id, cu.name, cu.city, cu.address, c.description, c.place, c.notes, c.product, c.callType].join(' ');
    if (!hit(txt, [cu.phone, c.contactPhone])) return;
    out.push({ kind: 'call', id: c.id, date: c.date || '', time: c.time || '', endTime: c.endTime || '', isTask: isTask_(c),
      title: isTask_(c) ? w.name : [w.city, w.name, fullLabel_(c)].filter(String).join(' · '), sub: isTask_(c) ? 'משימה' : c.product,
      status: c.status, assignedName: userName_(c.assignedUser), created: String(c.createdAt).slice(0, 10) });
  });
  if (isStaff_(me)) {
    read_('oldcal').forEach(function (e) {
      if (!hit(e.title + ' ' + e.location + ' ' + e.description, [e.title + ' ' + e.description])) return;
      var o = oldSpan_(e);
      o.title = e.title; o.location = e.location; o.color = e.color; o.description = String(e.description || '').slice(0, 600);
      out.push({ kind: 'old', date: o.start, time: o.allDay ? '' : o.time, title: e.title, sub: e.location || '', o: o });
    });
  }
  var key = function (x) { return (x.date || x.created || '') + ' ' + (x.time || ''); };
  var future = out.filter(function (x) { return x.date ? x.date >= today : OPEN_STATUSES.indexOf(x.status) >= 0; })
    .sort(function (a, b) { return key(a) < key(b) ? -1 : 1; });
  var past = out.filter(function (x) { return future.indexOf(x) < 0; }).sort(function (a, b) { return key(a) < key(b) ? 1 : -1; });
  return { future: future.slice(0, 40), past: past.slice(0, 60), more: future.length > 40 || past.length > 60 };
};

ACTIONS.searchOld = function (me, p) {
  need_(isStaff_(me));
  var q = String(p.q || '').trim();
  if (q.length < 2) return [];
  return read_('oldcal').filter(function (e) { return (e.title + ' ' + e.location + ' ' + e.description).indexOf(q) >= 0; })
    .slice(-30).reverse().map(function (e) { return { start: e.start, title: e.title, location: e.location, description: e.description }; });
};

function waPhone_(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.indexOf('972') === 0) return d;
  if (d.charAt(0) === '0') return '972' + d.slice(1);
  return d;
}

/** מחשב אילו התראות צריך לשלוח עכשיו (טהור, לבדיקה) */
function dueAlerts_(calls, users, custs, today, nowMin, remindMin, lateMin, sent) {
  var out = [], byTech = {};
  calls.forEach(function (c) {
    if (c.date !== today || !c.time || !c.assignedUser) return;
    if (['שובצה', 'תואם מועד'].indexOf(c.status) < 0) return;
    (byTech[c.assignedUser] = byTech[c.assignedUser] || []).push(c);
  });
  Object.keys(byTech).forEach(function (uid) {
    var u = users[uid]; if (!u || !u.phone) return;
    var list = byTech[uid].sort(function (a, b) { return a.time < b.time ? -1 : 1; });
    list.forEach(function (c, i) {
      var st = toMinS_(c.time), cu = custs[c.customerId] || {};
      var who = cu.name || '', where = [cu.address, cu.city].filter(String).join(', ');
      var kR = 'r|' + c.id + '|' + c.date + '|' + c.time;
      if (!sent[kR] && st - nowMin <= remindMin && st - nowMin > 0)
        out.push({ key: kR, callId: c.id, userId: uid, to: u.phone, type: 'tech_visit_reminder', params: [c.time, who, where, cu.phone || ''] });
      var kL = 'l|' + c.id + '|' + c.date + '|' + c.time;
      var prevOpen = list.slice(0, i).some(function (p) { return toMinS_(p.time) <= nowMin; });
      if (!sent[kL] && prevOpen && st - nowMin <= lateMin && nowMin - st <= 60)
        out.push({ key: kL, callId: c.id, userId: uid, to: u.phone, type: 'tech_running_late', params: [who, cu.city || where, c.time, cu.phone || ''] });
    });
  });
  return out;
}

function toMinS_(t) { var a = String(t).split(':'); return Number(a[0]) * 60 + Number(a[1] || 0); }
