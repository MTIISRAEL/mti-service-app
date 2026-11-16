/* Firestore/Auth בזיכרון – לבדיקות מקומיות בלבד */
(function () {
  var store = {}; try { store = JSON.parse(localStorage.getItem('__mockstore') || '{}'); } catch (e) {}
  function persist() { try { localStorage.setItem('__mockstore', JSON.stringify(store)); } catch (e) {} }
  var subs = [];
  var seq = 0;
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function colOf(path) { return path.split('/').slice(0, -1).join('/'); }
  function snapDoc(path) {
    var d = store[path];
    return { id: path.split('/').pop(), exists: function () { return !!d; }, data: function () { return d ? clone(d) : undefined; }, metadata: { hasPendingWrites: false } };
  }
  function match(q, data) {
    return (q.filters || []).every(function (f) {
      var v = data[f[0]];
      if (f[1] === '==') return v === f[2];
      if (f[1] === '>=') return v >= f[2];
      return true;
    });
  }
  function runQuery(q) {
    var out = Object.keys(store).filter(function (p) { return colOf(p) === q.col && match(q, store[p]); });
    if (q.order) out.sort(function (a, b) { var x = store[a][q.order[0]], y = store[b][q.order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (q.order[1] === 'desc' ? -1 : 1); });
    if (q.lim) out = out.slice(0, q.lim);
    return out;
  }
  function notify(changedPaths, local) {
    subs.forEach(function (s) {
      if (s.doc) {
        if (changedPaths.indexOf(s.doc) >= 0) s.next(snapDoc(s.doc));
        return;
      }
      var cur = runQuery(s.q), changes = [];
      cur.forEach(function (p) { if (changedPaths.indexOf(p) >= 0 || s.seen.indexOf(p) < 0) changes.push({ type: s.seen.indexOf(p) < 0 ? 'added' : 'modified', doc: Object.assign(snapDoc(p), { metadata: { hasPendingWrites: !!local } }) }); });
      s.seen.forEach(function (p) { if (cur.indexOf(p) < 0) changes.push({ type: 'removed', doc: snapDoc(p) }); });
      s.seen = cur;
      if (changes.length) s.next({ docChanges: function () { return changes; } });
    });
  }
  var db = { mock: true };
  var FB = {
    db: db, auth: { currentUser: null, languageCode: 'he' },
    doc: function (d, path) { return { path: path }; },
    collection: function (d, path) { return { col: path }; },
    where: function (f, op, v) { return { w: [f, op, v] }; },
    orderBy: function (f, dir) { return { o: [f, dir || 'asc'] }; },
    limit: function (n) { return { l: n }; },
    query: function (c) { var q = { col: c.col, filters: [] }; Array.prototype.slice.call(arguments, 1).forEach(function (x) { if (x.w) q.filters.push(x.w); if (x.o) q.order = x.o; if (x.l) q.lim = x.l; }); return q; },
    onSnapshot: function (ref, opts, next) {
      if (ref.path) { var s = { doc: ref.path, next: next }; subs.push(s); setTimeout(function () { next(snapDoc(ref.path)); }, 5); return function () { subs.splice(subs.indexOf(s), 1); }; }
      var q = ref.col ? { col: ref.col, filters: [] } : ref;
      var s2 = { q: q, next: next, seen: [] }; subs.push(s2);
      setTimeout(function () {
        var cur = runQuery(q); s2.seen = cur;
        next({ docChanges: function () { return cur.map(function (p) { return { type: 'added', doc: snapDoc(p) }; }); } });
      }, 5);
      return function () { subs.splice(subs.indexOf(s2), 1); };
    },
    getDoc: function (ref) { return Promise.resolve(snapDoc(ref.path)); },
    getDocs: function (ref) {
      var q = ref.col && !ref.filters ? { col: ref.col, filters: [] } : ref;
      var docs = runQuery(q).map(snapDoc);
      return Promise.resolve({ forEach: function (fn) { docs.forEach(fn); }, docs: docs });
    },
    serverTimestamp: function () { return '__ts' + (++seq); },
    writeBatch: function () {
      var ops = [];
      return {
        set: function (ref, data, o) { ops.push(['set', ref.path, data, o && o.merge]); },
        update: function (ref, data) { ops.push(['set', ref.path, data, true]); },
        delete: function (ref) { ops.push(['del', ref.path]); },
        commit: function () {
          window.__writes = (window.__writes || []).concat(clone(ops));
          var ch = [];
          ops.forEach(function (op) {
            if (op[0] === 'del') { delete store[op[1]]; ch.push(op[1]); return; }
            store[op[1]] = op[3] && store[op[1]] ? Object.assign(store[op[1]], clone(op[2])) : clone(op[2]);
            ch.push(op[1]);
          });
          persist(); notify(ch, false);
          return Promise.resolve();
        }
      };
    },
    runTransaction: function (d, fn) {
      var tx = { get: function (ref) { return Promise.resolve(snapDoc(ref.path)); }, set: function (ref, data, o) { store[ref.path] = Object.assign(store[ref.path] || {}, clone(data)); persist(); } };
      return fn(tx);
    },
    onAuthStateChanged: function (a, cb) { setTimeout(function () { var e = localStorage.getItem('__mockuser'); cb(e ? { uid: 'u_' + e, email: e } : null); }, 10); },
    signOut: function () { localStorage.removeItem('__mockuser'); return Promise.resolve(); },
    GoogleAuthProvider: function () {},
    signInWithPopup: function () { return Promise.resolve(); },
    signInWithRedirect: function () { return Promise.resolve(); },
    getRedirectResult: function () { return Promise.resolve(null); },
    sendSignInLinkToEmail: function () { return Promise.resolve(); },
    isSignInWithEmailLink: function () { return false; },
    signInWithEmailLink: function () { return Promise.resolve(); }
  };
  window.FB = FB;
  window.__store = store;
  window.__seed = function (data) { for (var p in data) store[p] = clone(data[p]); persist(); };
})();
