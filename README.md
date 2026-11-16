# MTI שירות – אפליקציית קריאות שירות

אתר סטטי (GitHub Pages) + Firebase (Firestore + Authentication) + מנוע ברקע ב-Apps Script.

- `index.html` – הממשק. `core.js` – הלוגיקה (משותפת לאתר ולמנוע). `db.js` – עותק חי של הנתונים בטלפון וכתיבה ל-Firestore.
- `firestore.rules` – כללי האבטחה (מדביקים ב-Firebase Console > Firestore > Rules).
- `worker/` – קוד ה-Apps Script: `core.gs` הוא העתק של `core.js`, ועוד `worker.gs`, `gcal.gs`, `admin.gs`.
