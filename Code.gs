/*************************************************************
 *  พอร์ตน้อง — Google Apps Script (ฝั่ง Google)
 *  ------------------------------------------------------------
 *  หน้าที่ของสคริปต์นี้:
 *   1) รับ "ข้อความ" (kind:'meta') จากฟอร์ม แล้วเขียนลงแถวใน Google Sheet
 *   2) รับ "รูปภาพ" (kind:'image') ทีละใบ (เป็น base64) แล้ว
 *      - สร้าง/หาโฟลเดอร์  พอร์ตน้อง / [ชื่อนักเรียน] / [หมวด] / ...
 *      - เซฟรูปลงโฟลเดอร์นั้น (ตั้งชื่อไฟล์ตามที่น้องพิมพ์ + เลขลำดับนำหน้า)
 *      - เอา "ลิงก์รูป" ไปเติมในแถวเดียวกับข้อมูลน้อง (ผูกด้วย submissionId)
 *
 *  วิธีติดตั้งอ่านในไฟล์ README.md ที่อยู่โฟลเดอร์เดียวกัน
 *************************************************************/

/* ====== ตั้งค่า (แก้ได้ตามต้องการ) ====== */

// ชื่อโฟลเดอร์หลักใน Google Drive (จะถูกสร้างให้อัตโนมัติถ้ายังไม่มี)
var ROOT_FOLDER_NAME = 'พอร์ตน้อง';

// ชื่อชีต (แท็บ) ที่จะเก็บข้อมูล — ถ้ายังไม่มีจะสร้างให้
var SHEET_NAME = 'ข้อมูลพอร์ต';

// ถ้าเปิด Apps Script จากในไฟล์ Google Sheet โดยตรง (แนะนำ) → ปล่อยว่าง '' ไว้
// ถ้าเป็นสคริปต์แยก (standalone) → ใส่ Spreadsheet ID (ส่วนกลางของ URL ชีต) ที่นี่
var SPREADSHEET_ID = '';

// ตั้งค่าการแชร์ลิงก์รูป:
//   true  = ใครมีลิงก์ก็เปิดดูได้ (สะดวก คลิกจากชีตเปิดได้เลย แต่ต้องไม่ติดนโยบายองค์กร)
//   false = เฉพาะเจ้าของ/คนที่มีสิทธิ์เท่านั้น (ปลอดภัยกว่า เจ้าของชีตคลิกเปิดได้อยู่แล้ว)
var MAKE_LINKS_PUBLIC = true;


/* ====== จุดรับ POST จากฟอร์ม ====== */
function doPost(e) {
  // ใช้ LockService กันหลาย request เขียนชนกัน (เพราะรูปถูกส่งมาหลายใบพร้อม ๆ กัน)
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (errLock) { /* รอไม่ได้ก็ทำต่อ */ }

  try {
    var data = JSON.parse(e.postData.contents);

    if (data.kind === 'image') {
      return handleImage_(data);          // บันทึกรูป 1 ใบ
    } else {
      return handleMeta_(data);           // บันทึกข้อความ (kind:'meta' หรือ payload เก่า)
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// เผื่อเปิด URL ตรง ๆ บนเบราว์เซอร์ เพื่อเช็คว่า deploy สำเร็จ
function doGet() {
  return jsonOut_({ ok: true, service: 'พอร์ตน้อง', time: new Date() });
}


/* ====== บันทึก "ข้อความ" ลงชีต ====== */
function handleMeta_(data) {
  var sh  = getSheet_();
  var row = ensureRow_(sh, data.submissionId, data.studentName);

  // คอลัมน์หลัก
  setCell_(sh, row, 'เวลา',         new Date());
  setCell_(sh, row, 'ชื่อนักเรียน',  data.studentName || '');
  setCell_(sh, row, 'ภาษาพอร์ต',    data.lang || '');
  setCell_(sh, row, 'จำนวนรูป',     (data.imageCount != null ? data.imageCount : ''));

  // ฟิลด์ทั้งหมดจากฟอร์ม (คีย์เป็นภาษาไทย) — เขียนลงคอลัมน์ตามชื่อคีย์
  var fields = data.fields || {};
  Object.keys(fields).forEach(function (k) {
    if (fields[k] !== '' && fields[k] != null) setCell_(sh, row, k, fields[k]);
  });

  return jsonOut_({ ok: true, row: row });
}


/* ====== บันทึก "รูป 1 ใบ" ลง Drive + เติมลิงก์ในชีต ====== */
function handleImage_(data) {
  // 1) เตรียมโฟลเดอร์: พอร์ตน้อง / [ชื่อนักเรียน] / [หมวด...]
  var root     = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  var student  = getOrCreateFolder_(root, safeName_(data.studentName || 'ไม่ระบุชื่อ'));

  // หมวดอาจมี '/' เช่น "กิจกรรม/จิตอาสา" → สร้างโฟลเดอร์ซ้อนกันเป็นชั้น ๆ
  var target = student;
  String(data.category || 'อื่นๆ').split('/').forEach(function (part) {
    part = safeName_(part);
    if (part) target = getOrCreateFolder_(target, part);
  });

  // 2) ตั้งชื่อไฟล์: เลขลำดับ + ชื่อที่น้องพิมพ์ (ถ้าไม่มีใช้ชื่อไฟล์เดิม) + นามสกุล
  var order = (data.order != null ? pad2_(data.order) : '');
  var base  = safeName_(data.title || stripExt_(data.filename) || 'รูป');
  var ext   = extFrom_(data.filename, data.mime);
  var finalName = (order ? order + '_' : '') + base + ext;

  // 3) แปลง base64 กลับเป็นไฟล์ แล้วเซฟลงโฟลเดอร์
  var bytes = Utilities.base64Decode(data.dataBase64);
  var blob  = Utilities.newBlob(bytes, data.mime || 'application/octet-stream', finalName);
  var file  = target.createFile(blob);
  file.setName(finalName);

  // 4) ตั้งค่าการแชร์ (ถ้าเปิดไว้) เพื่อให้คลิกจากชีตเปิดดูได้
  if (MAKE_LINKS_PUBLIC) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (eShare) {}
  }
  var url = file.getUrl();

  // 5) เติมลิงก์รูปลงแถวเดียวกับข้อมูลน้อง (ผูกด้วย submissionId)
  var sh  = getSheet_();
  var row = ensureRow_(sh, data.submissionId, data.studentName);
  var label = '[' + (data.category || '') + '] ' + (data.title || finalName) +
              (data.detail ? (' (' + data.detail + ')') : '') + ' : ' + url;
  appendCell_(sh, row, 'ลิงก์รูปทั้งหมด', label);

  return jsonOut_({ ok: true, url: url, file: finalName });
}


/* =======================================================
 *  ฟังก์ชันช่วยเหลือ (helpers)
 * ======================================================= */

// เปิด Spreadsheet + หา/สร้างชีต และใส่หัวตารางถ้ายังว่าง
function getSheet_() {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID)
                          : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('ไม่พบ Spreadsheet — ถ้าเป็นสคริปต์แยก ให้ใส่ค่า SPREADSHEET_ID');
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['เวลา', 'submissionId', 'ชื่อนักเรียน', 'ภาษาพอร์ต', 'จำนวนรูป', 'ลิงก์รูปทั้งหมด']);
  }
  return sh;
}

// หาเลขคอลัมน์จากชื่อหัวตาราง ถ้าไม่มีให้สร้างคอลัมน์ใหม่ต่อท้าย (คืนค่าเป็น 1-based)
function colIndex_(sh, name) {
  var lastCol = Math.max(1, sh.getLastColumn());
  var header  = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = header.indexOf(name);
  if (idx === -1) {
    idx = header.length;                 // คอลัมน์ถัดไป
    sh.getRange(1, idx + 1).setValue(name);
  }
  return idx + 1;
}

// หาแถวจาก submissionId (คอลัมน์ B) — ไม่เจอคืน -1
function findRowBySubmission_(sh, submissionId) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(submissionId)) return i + 2;
  }
  return -1;
}

// หาแถวของ submissionId นี้ ถ้ายังไม่มีให้สร้างแถวใหม่
function ensureRow_(sh, submissionId, studentName) {
  var row = findRowBySubmission_(sh, submissionId);
  if (row === -1) {
    sh.appendRow([new Date(), submissionId || '', studentName || '', '', '', '']);
    row = sh.getLastRow();
  }
  return row;
}

// เขียนค่าในเซลล์ (แถว, ชื่อคอลัมน์)
function setCell_(sh, row, colName, value) {
  sh.getRange(row, colIndex_(sh, colName)).setValue(value);
}

// ต่อท้ายค่าในเซลล์เดิม (ขึ้นบรรทัดใหม่) — ใช้กับคอลัมน์ลิงก์รูปที่สะสมหลายใบ
function appendCell_(sh, row, colName, value) {
  var cell = sh.getRange(row, colIndex_(sh, colName));
  var cur  = cell.getValue();
  cell.setValue(cur ? (cur + '\n' + value) : value);
}

// หา/สร้างโฟลเดอร์ลูกชื่อ name ภายใต้ parent
function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// ตัดอักขระต้องห้ามในชื่อไฟล์/โฟลเดอร์ออก
function safeName_(s) {
  s = String(s == null ? '' : s);
  return s.replace(/[\\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// เติมเลข 0 ข้างหน้าให้เป็น 2 หลัก (1 → "01")
function pad2_(n) { n = String(n); return n.length < 2 ? ('0' + n) : n; }

// ตัดนามสกุลไฟล์ออกจากชื่อ
function stripExt_(name) {
  return String(name || '').replace(/\.[^.\/]+$/, '');
}

// หานามสกุลไฟล์จากชื่อไฟล์ ถ้าไม่มีเดาจาก mime
function extFrom_(filename, mime) {
  var m = String(filename || '').match(/\.([a-z0-9]+)$/i);
  if (m) return '.' + m[1].toLowerCase();
  var map = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
    'image/gif': '.gif', 'image/bmp': '.bmp'
  };
  return map[mime] || '';
}

// ส่งผลลัพธ์กลับเป็น JSON
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}
