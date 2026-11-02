/**
 * AI프론티어 팀 활동·영수증 — 구글 시트 연결 스크립트 (Google Apps Script)
 *
 * 설치(교육팀 1회, 약 10분)
 *  1) 구글 드라이브에서 새 스프레드시트를 만든다. (이름 예: AI프론티어 팀 기록)
 *  2) 메뉴 [확장 프로그램 → Apps Script] → 기본 코드를 모두 지우고 이 파일 전체를 붙여 넣고 저장.
 *  3) [배포 → 새 배포 → 유형: 웹 앱] → 실행: 나 / 액세스 권한이 있는 사용자: 모든 사용자 → 배포 → 권한 허용.
 *  4) 나온 웹 앱 URL(…/exec)을 앱의 [교육팀 설정] 화면에 붙여 넣는다. 탭·팀 코드·사진 폴더가 자동으로 만들어진다.
 *
 * 데이터는 이 시트의 탭(설정·팀·활동기록·영수증·파일·변경이력)에, 사진·영수증 파일은 내 드라이브의
 * 「AI프론티어 팀 기록 (사진·영수증)」 폴더에 쌓인다. 팀 코드가 맞아야만 읽고 쓸 수 있다.
 * 영수증은 따로 올리지 않고 활동 기록에 붙인다(영수증 탭의 「연결활동」 칸 = 활동 id).
 * 코드를 고친 뒤에는 [배포 → 배포 관리 → 편집(연필) → 버전: 새 버전 → 배포]를 해야 반영된다(URL은 그대로).
 */

var VERSION = '2026-11-02.1';
var TZ = 'Asia/Seoul';
var DEFAULT_BUDGET = 1000000;
var DEFAULT_TEAMS = [
  ['A1', 'A-1팀', '진료 예약'],
  ['A2', 'A-2팀', '진료 예약'],
  ['B1', 'B-1팀', '검사 장비'],
  ['B2', 'B-2팀', '검사 장비'],
  ['C', 'C팀', '간호 인력']
];
var ACT_TYPES = ['자율스터디', '팀 회의', '멘토링', '기타'];
var RCP_STATUS = ['제출', '확인', '보완요청'];
var MAX_FILES = 4;
var MAX_FILE_B64 = 12 * 1024 * 1024;   // base64 길이 기준(원본 약 9MB)
var MAX_THUMB = 45000;                 // 시트 셀 한도 50,000자
var FAIL_LIMIT = 20;                   // 10분 안에 20번 틀리면
var FAIL_WINDOW = 600;                 // 10분 잠금
var OK_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;

// 열 정의: [키, 시트 머리글, 종류]  종류 t=글자 n=숫자 d=날짜 h=시각 s=일시
var TABS = {
  set: { name: '설정', cols: [['key', '항목', 't'], ['value', '값', 't'], ['note', '설명', 't']] },
  team: { name: '팀', cols: [['id', '팀ID', 't'], ['name', '팀명', 't'], ['project', '프로젝트', 't'], ['budget', '예산', 'n'],
    ['code', '팀코드', 't'], ['members', '팀원', 't'], ['order', '순서', 'n']] },
  act: { name: '활동기록', cols: [['id', 'id', 't'], ['team', '팀ID', 't'], ['type', '유형', 't'], ['date', '날짜', 'd'],
    ['start', '시작', 'h'], ['end', '종료', 'h'], ['hours', '시간', 'n'], ['place', '장소', 't'], ['attendees', '참석자', 't'],
    ['topic', '주제', 't'], ['content', '내용', 't'], ['next', '다음할일', 't'], ['writer', '작성자', 't'],
    ['created', '작성시각', 's'], ['updated', '수정시각', 's'], ['deleted', '삭제', 't']] },
  rcp: { name: '영수증', cols: [['id', 'id', 't'], ['team', '팀ID', 't'], ['date', '사용일', 'd'], ['amount', '금액', 'n'],
    ['store', '사용처', 't'], ['category', '분류', 't'], ['item', '내용', 't'], ['people', '인원', 'n'], ['payer', '결제자', 't'],
    ['method', '결제수단', 't'], ['actId', '연결활동', 't'], ['memo', '메모', 't'], ['status', '상태', 't'],
    ['reviewNote', '확인메모', 't'], ['reviewed', '확인시각', 's'], ['writer', '작성자', 't'],
    ['created', '작성시각', 's'], ['updated', '수정시각', 's'], ['deleted', '삭제', 't']] },
  file: { name: '파일', cols: [['id', 'id', 't'], ['team', '팀ID', 't'], ['owner', '대상', 't'], ['driveId', '드라이브ID', 't'],
    ['name', '파일명', 't'], ['mime', '형식', 't'], ['size', '크기', 'n'], ['created', '작성시각', 's'], ['deleted', '삭제', 't'],
    ['thumb', '썸네일', 't']] },
  log: { name: '변경이력', cols: [['at', '시각', 's'], ['who', '누가', 't'], ['action', '작업', 't'], ['target', '대상', 't'],
    ['summary', '내용', 't']] }
};
var SET_KEYS = {
  adminCode: ['관리자코드', '교육팀 관리자 화면에 들어가는 번호'],
  courseName: ['과정명', '화면 위쪽에 보이는 이름'],
  openActs: ['활동기록공개', 'Y면 팀끼리 서로의 활동 기록을 볼 수 있음(영수증은 항상 자기 팀만)'],
  studyGoal: ['자율스터디목표', '팀별 자율스터디 목표 횟수'],
  studyHours: ['자율스터디시간', '자율스터디 1회 공가 인정 시간'],
  folderId: ['드라이브폴더ID', '사진·영수증 파일이 저장되는 내 드라이브 폴더'],
  createdAt: ['만든시각', '처음 설정한 시각']
};

var ROUTES = {
  ping: ping_, setup: setup_, load: load_,
  saveAct: saveAct_, deleteAct: deleteAct_,
  saveRcp: saveRcp_, deleteRcp: deleteRcp_,
  getFile: getFile_, saveMembers: saveMembers_,
  review: review_, saveTeams: saveTeams_, saveSettings: saveSettings_
};

var _C = {}; // 한 번 실행하는 동안만 쓰는 캐시

/* ───────── 입구 ───────── */

function doGet() {
  return out_(handle_({ action: 'ping' })); // 주소창으로 열면 상태만 보여 준다
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_(bad_('bad_request', '요청 형식이 올바르지 않습니다.')); }
  return out_(handle_(req || {}));
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  _C = {};
  try {
    var fn = ROUTES[String(req.action || '')];
    if (!fn) return bad_('unknown_action', '알 수 없는 요청입니다.');
    var res = fn(req) || {};
    res.ok = true;
    res.version = VERSION;
    return res;
  } catch (err) {
    if (err && err.appCode) return bad_(err.appCode, err.message);
    return bad_('server_error', '서버 오류: ' + String((err && err.message) || err));
  }
}

function bad_(code, message) { return { ok: false, error: code, message: message, version: VERSION }; }
function appErr_(code, message) { var e = new Error(message); e.appCode = code; return e; }

/* ───────── 요청 처리 ───────── */

function ping_() {
  var ready = isReady_();
  var res = { ready: ready };
  if (ready) {
    res.courseName = settings_().courseName;
    // 로그인 화면은 코드 없이도 보이므로 팀원 이름은 가운데 글자를 가려서 보낸다(윤○진). 코드는 보내지 않음
    res.teams = teams_().map(function (t) { return { id: t.id, name: t.name, project: t.project, members: splitList_(t.members).map(maskName_) }; });
  }
  return res;
}

function setup_() {
  return withLock_(function () {
    if (isReady_()) return { created: false, ready: true };
    var ss = ss_();
    Object.keys(TABS).forEach(function (k) { ensureTab_(ss, k); });
    _C = {};
    rootFolder_();
    var codes = [];
    if (!teams_().length) {
      DEFAULT_TEAMS.forEach(function (t, i) {
        var c = newCode_(codes); codes.push(c);
        writeRow_('team', { id: t[0], name: t[1], project: t[2], budget: DEFAULT_BUDGET, code: c, members: '', order: i + 1 }, 0);
      });
    } else {
      teams_().forEach(function (t) { codes.push(String(t.code)); });
    }
    buildTeamViews_();
    var S = settings_();
    if (!S.courseName) setSetting_('courseName', 'AI프론티어');
    if (!S.openActs) setSetting_('openActs', 'N');
    if (!S.studyGoal) setSetting_('studyGoal', '5');
    if (!S.studyHours) setSetting_('studyHours', '4');
    setSetting_('createdAt', now_());
    var adminCode = newCode_(codes);
    setSetting_('adminCode', adminCode); // 마지막에 써야 중간에 실패해도 다시 설정할 수 있다
    log_({ label: '설치' }, '처음 설정', '', '탭·팀 코드·사진 폴더 생성');
    return { created: true, ready: true, adminCode: adminCode, sheetUrl: ss.getUrl() };
  });
}

function load_(req) {
  var who = auth_(req);
  var S = settings_();
  var teams = teams_();
  var acts = live_(readAll_('act'));
  var rcps = live_(readAll_('rcp'));
  var files = live_(readAll_('file'));
  var res = { settings: pubSettings_(S) };
  if (who.admin) {
    res.role = 'admin';
    res.teams = teams.map(function (t) { return pubTeam_(t, true); });
    res.acts = acts.map(pubAct_);
    res.rcps = rcps.map(pubRcp_);
    res.files = files.map(pubFile_);
    res.sheetUrl = ss_().getUrl();
    res.folderUrl = S.folderId ? 'https://drive.google.com/drive/folders/' + S.folderId : '';
    return res;
  }
  var tid = who.team.id;
  var open = S.openActs === 'Y';
  res.role = 'team';
  res.team = pubTeam_(who.team, false);
  res.teams = teams.map(function (t) { return { id: t.id, name: t.name, project: t.project }; });
  res.acts = acts.filter(function (a) { return a.team === tid || open; }).map(pubAct_);
  res.rcps = rcps.filter(function (r) { return r.team === tid; }).map(pubRcp_);
  var seen = {};
  res.acts.forEach(function (a) { seen['A:' + a.id] = true; });
  res.files = files.filter(function (f) { return f.team === tid || (open && seen[f.owner]); }).map(pubFile_);
  return res;
}

function saveAct_(req) {
  var who = auth_(req);
  var a = req.act || {};
  return withLock_(function () {
    var tid = who.admin ? str_(a.team, 10) : who.team.id;
    if (!teamById_(tid)) throw appErr_('bad', '팀을 찾을 수 없습니다.');
    var id = cleanId_(a.id, 'a');
    var ex = find_(readAll_('act'), id);
    if (ex && ex.team !== tid) throw appErr_('forbidden', '다른 팀의 기록입니다.');
    if (ex && ex.deleted === 'Y') throw appErr_('deleted', '이미 삭제된 기록입니다.');
    var date = date_(a.date);
    if (!date) throw appErr_('bad', '날짜를 확인해 주세요.');
    var start = time_(a.start), end = time_(a.end);
    var now = now_();
    var obj = {
      id: id, team: tid, type: ACT_TYPES.indexOf(a.type) >= 0 ? a.type : '기타', date: date, start: start, end: end,
      hours: (start && end) ? hoursBetween_(start, end) : round2_(num_(a.hours, 0, 24)),
      place: str_(a.place, 100), attendees: list_(a.attendees, 40).join(', '), topic: str_(a.topic, 200),
      content: str_(a.content, 20000), next: str_(a.next, 5000), writer: str_(a.writer, 30), updated: now, deleted: ''
    };
    if (!ex) obj.created = now;
    var plan = checkFiles_('A:' + id, req.newFiles, req.removeFiles);
    writeRow_('act', obj, ex ? ex._row : 0);
    var files = applyFiles_(tid, 'A:' + id, plan);
    log_(who, ex ? '활동 수정' : '활동 등록', id, obj.date + ' ' + obj.type + ' ' + obj.topic);
    return { act: pubAct_(merge_(ex, obj)), files: files };
  });
}

function deleteAct_(req) {
  var who = auth_(req);
  return withLock_(function () {
    var ex = find_(readAll_('act'), String(req.id || ''));
    if (!ex || ex.deleted === 'Y') return { deleted: true, rcps: [] };
    if (!who.admin && ex.team !== who.team.id) throw appErr_('forbidden', '다른 팀의 기록입니다.');
    // 붙어 있는 영수증도 같이 지운다. 교육팀 확인이 끝난 영수증이 있으면 팀은 지울 수 없다
    var rcs = live_(readAll_('rcp')).filter(function (r) { return r.actId === ex.id; });
    if (!who.admin && rcs.some(function (r) { return r.status === '확인'; })) {
      throw appErr_('locked', '교육팀 확인이 끝난 영수증이 붙어 있어 지울 수 없습니다. 교육팀에 알려 주세요.');
    }
    var now = now_();
    writeRow_('act', { deleted: 'Y', updated: now }, ex._row);
    trashOwner_('A:' + ex.id);
    rcs.forEach(function (r) { writeRow_('rcp', { deleted: 'Y', updated: now }, r._row); trashOwner_('R:' + r.id); });
    log_(who, '활동 삭제', ex.id, ex.date + ' ' + ex.topic + (rcs.length ? ' (영수증 ' + rcs.length + '건 함께)' : ''));
    return { deleted: true, rcps: rcs.map(function (r) { return r.id; }) };
  });
}

function saveRcp_(req) {
  var who = auth_(req);
  var r = req.rcp || {};
  return withLock_(function () {
    var tid = who.admin ? str_(r.team, 10) : who.team.id;
    if (!teamById_(tid)) throw appErr_('bad', '팀을 찾을 수 없습니다.');
    var id = cleanId_(r.id, 'r');
    var ex = find_(readAll_('rcp'), id);
    if (ex && ex.team !== tid) throw appErr_('forbidden', '다른 팀의 영수증입니다.');
    if (ex && ex.deleted === 'Y') throw appErr_('deleted', '이미 삭제된 영수증입니다.');
    if (ex && ex.status === '확인' && !who.admin) {
      throw appErr_('locked', '교육팀 확인이 끝난 영수증은 고칠 수 없습니다. 고칠 내용은 교육팀에 알려 주세요.');
    }
    var date = date_(r.date);
    if (!date) throw appErr_('bad', '사용일을 확인해 주세요.');
    var amount = Math.round(num_(r.amount, 0, 100000000));
    if (!(amount > 0)) throw appErr_('bad', '금액을 확인해 주세요.');
    var store = str_(r.store, 100);
    if (!store) throw appErr_('bad', '사용처(가게 이름)를 적어 주세요.');
    // 영수증은 활동 기록에 붙는다: 같은 팀의 지워지지 않은 활동이어야 한다
    var actId = str_(r.actId, 40) || (ex ? String(ex.actId || '') : '');
    var act = actId ? find_(readAll_('act'), actId) : null;
    if (!act || act.deleted === 'Y' || act.team !== tid) {
      throw appErr_('bad', '영수증은 활동 기록 안에서 붙여 주세요. 화면을 새로고침한 뒤 다시 시도해 주세요.');
    }
    var now = now_();
    var people = Math.round(num_(r.people, 0, 999));
    var obj = {
      id: id, team: tid, date: date, amount: amount, store: store, category: str_(r.category, 20) || '기타',
      item: str_(r.item, 500), people: people > 0 ? people : '', payer: str_(r.payer, 30), method: str_(r.method, 20),
      actId: actId, memo: str_(r.memo, 1000), writer: str_(r.writer, 30), updated: now, deleted: ''
    };
    if (!ex) { obj.created = now; obj.status = '제출'; }
    else if (!who.admin && ex.status === '보완요청') obj.status = '제출'; // 고치면 다시 제출 상태
    var plan = checkFiles_('R:' + id, req.newFiles, req.removeFiles);
    writeRow_('rcp', obj, ex ? ex._row : 0);
    var files = applyFiles_(tid, 'R:' + id, plan);
    log_(who, ex ? '영수증 수정' : '영수증 제출', id, obj.date + ' ' + obj.store + ' ' + obj.amount + '원');
    return { rcp: pubRcp_(merge_(ex, obj)), files: files };
  });
}

function deleteRcp_(req) {
  var who = auth_(req);
  return withLock_(function () {
    var ex = find_(readAll_('rcp'), String(req.id || ''));
    if (!ex || ex.deleted === 'Y') return { deleted: true };
    if (!who.admin && ex.team !== who.team.id) throw appErr_('forbidden', '다른 팀의 영수증입니다.');
    if (!who.admin && ex.status === '확인') throw appErr_('locked', '교육팀 확인이 끝난 영수증은 지울 수 없습니다.');
    writeRow_('rcp', { deleted: 'Y', updated: now_() }, ex._row);
    trashOwner_('R:' + ex.id);
    log_(who, '영수증 삭제', ex.id, ex.date + ' ' + ex.store + ' ' + ex.amount + '원');
    return { deleted: true };
  });
}

function getFile_(req) {
  var who = auth_(req);
  var f = find_(readAll_('file'), String(req.id || ''));
  if (!f || f.deleted === 'Y') throw appErr_('not_found', '파일을 찾을 수 없습니다.');
  if (!who.admin && f.team !== who.team.id) {
    var shared = settings_().openActs === 'Y' && f.owner.indexOf('A:') === 0;
    if (!shared) throw appErr_('forbidden', '볼 수 없는 파일입니다.');
  }
  var blob = DriveApp.getFileById(f.driveId).getBlob();
  return { id: f.id, name: f.name, mime: f.mime, data: Utilities.base64Encode(blob.getBytes()) };
}

function saveMembers_(req) {
  var who = auth_(req);
  return withLock_(function () {
    var tid = who.admin ? String(req.team || '') : who.team.id;
    var t = teamById_(tid);
    if (!t) throw appErr_('bad', '팀을 찾을 수 없습니다.');
    var members = list_(req.members, 30);
    writeRow_('team', { members: members.join(', ') }, t._row);
    log_(who, '팀원 수정', tid, members.join(', '));
    return { members: members };
  });
}

function review_(req) {
  var who = auth_(req);
  if (!who.admin) throw appErr_('forbidden', '교육팀만 할 수 있습니다.');
  return withLock_(function () {
    var ex = find_(readAll_('rcp'), String(req.id || ''));
    if (!ex || ex.deleted === 'Y') throw appErr_('not_found', '영수증을 찾을 수 없습니다.');
    var status = RCP_STATUS.indexOf(req.status) >= 0 ? req.status : '제출';
    var obj = { status: status, reviewNote: str_(req.note, 500), reviewed: status === '제출' ? '' : now_() };
    writeRow_('rcp', obj, ex._row);
    log_(who, '영수증 ' + status, ex.id, ex.store + ' ' + ex.amount + '원 ' + obj.reviewNote);
    return { rcp: pubRcp_(merge_(ex, obj)) };
  });
}

function saveTeams_(req) {
  var who = auth_(req);
  if (!who.admin) throw appErr_('forbidden', '교육팀만 할 수 있습니다.');
  return withLock_(function () {
    var cur = teams_();
    var list = Array.isArray(req.teams) ? req.teams : [];
    var codes = {};
    var adminCode = String(settings_().adminCode);
    list.forEach(function (t) {
      var code = String(t.code || '').trim();
      if (!/^[0-9A-Za-z]{4,12}$/.test(code)) throw appErr_('bad', (t.name || t.id) + ' 코드는 4~12자리 숫자·영문이어야 합니다.');
      if (codes[code] || code === adminCode) throw appErr_('bad', '팀 코드가 서로 겹치거나 관리자 코드와 같습니다: ' + code);
      codes[code] = true;
    });
    list.forEach(function (t) {
      var ex = find_(cur, String(t.id || ''));
      if (!ex) return; // 팀 추가·삭제는 시트에서 한다
      writeRow_('team', {
        name: str_(t.name, 30) || ex.name, project: str_(t.project, 40), budget: Math.round(num_(t.budget, 0, 1e9)),
        code: String(t.code).trim(), members: list_(t.members, 30).join(', ')
      }, ex._row);
    });
    log_(who, '팀 설정 저장', '', list.length + '팀');
    _C = { ss: _C.ss };
    buildTeamViews_(); // 팀 이름이 바뀌면 보기 탭 이름도 따라 바뀐다
    return { teams: teams_().map(function (t) { return pubTeam_(t, true); }) };
  });
}

function saveSettings_(req) {
  var who = auth_(req);
  if (!who.admin) throw appErr_('forbidden', '교육팀만 할 수 있습니다.');
  return withLock_(function () {
    var s = req.settings || {};
    if (s.courseName !== undefined) setSetting_('courseName', str_(s.courseName, 40) || 'AI프론티어');
    if (s.openActs !== undefined) setSetting_('openActs', s.openActs === 'Y' || s.openActs === true ? 'Y' : 'N');
    if (s.studyGoal !== undefined) setSetting_('studyGoal', String(Math.round(num_(s.studyGoal, 0, 99))));
    if (s.studyHours !== undefined) setSetting_('studyHours', String(round2_(num_(s.studyHours, 0, 24))));
    if (s.adminCode !== undefined && s.adminCode !== '') {
      var code = String(s.adminCode).trim();
      if (!/^[0-9A-Za-z]{4,12}$/.test(code)) throw appErr_('bad', '관리자 코드는 4~12자리 숫자·영문이어야 합니다.');
      var clash = teams_().some(function (t) { return String(t.code).trim() === code; });
      if (clash) throw appErr_('bad', '팀 코드와 같은 번호는 관리자 코드로 쓸 수 없습니다.');
      setSetting_('adminCode', code);
    }
    log_(who, '설정 저장', '', JSON.stringify(s.adminCode ? { adminCode: '변경' } : s).slice(0, 200));
    return { settings: pubSettings_(settings_()) };
  });
}

/* ───────── 인증 ───────── */

function auth_(req) {
  if (!isReady_()) throw appErr_('not_ready', '아직 설정되지 않았습니다. 교육팀이 처음 설정을 마쳐야 합니다.');
  var a = req.auth || {};
  if (a.admin !== undefined && a.admin !== null && String(a.admin) !== '') {
    guard_('admin');
    if (String(a.admin).trim() !== String(settings_().adminCode).trim()) {
      noteFail_('admin');
      throw appErr_('auth_admin', '관리자 코드가 맞지 않습니다.');
    }
    return { admin: true, team: null, label: '교육팀' };
  }
  var tid = String(a.team || '');
  guard_('team_' + tid);
  var t = teamById_(tid);
  var code = String(a.code || '').trim();
  if (!t || !code || String(t.code).trim() !== code) {
    noteFail_('team_' + tid);
    throw appErr_('auth', '팀 코드가 맞지 않습니다. 교육팀이 보낸 팀 링크로 다시 열어 주세요.');
  }
  return { admin: false, team: t, label: t.name };
}

function guard_(key) {
  var n = Number(CacheService.getScriptCache().get('fail_' + key) || 0);
  if (n >= FAIL_LIMIT) throw appErr_('locked', '잘못된 코드가 여러 번 들어와 10분 동안 잠겼습니다. 잠시 뒤 다시 시도해 주세요.');
}

function noteFail_(key) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('fail_' + key) || 0) + 1;
  cache.put('fail_' + key, String(n), FAIL_WINDOW);
}

/* ───────── 시트 읽기·쓰기 ───────── */

function ss_() {
  if (_C.ss) return _C.ss;
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  var props = PropertiesService.getScriptProperties();
  if (ss) {
    if (props.getProperty('SS_ID') !== ss.getId()) props.setProperty('SS_ID', ss.getId());
  } else {
    var id = props.getProperty('SS_ID');
    if (!id) throw appErr_('no_sheet', '연결된 스프레드시트가 없습니다. 시트의 [확장 프로그램 → Apps Script]에서 만든 스크립트인지 확인해 주세요.');
    ss = SpreadsheetApp.openById(id);
  }
  _C.ss = ss;
  return ss;
}

function isReady_() {
  if (_C.ready !== undefined) return _C.ready;
  var ss = ss_();
  var ok = !!(ss.getSheetByName(TABS.set.name) && ss.getSheetByName(TABS.team.name)) && !!settings_().adminCode;
  _C.ready = ok;
  return ok;
}

function ensureTab_(ss, key) {
  var t = TABS[key];
  var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
  var hdr = t.cols.map(function (c) { return c[1]; });
  sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold').setBackground('#e8eef8');
  sh.setFrozenRows(1);
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  t.cols.forEach(function (c, i) {
    var fmt = c[2] === 'n' ? (c[0] === 'hours' ? '0.0#' : '#,##0') : '@';
    sh.getRange(2, i + 1, rows, 1).setNumberFormat(fmt);
    if (/^(content|next|item|memo|members|summary|note|value)$/.test(c[0])) sh.setColumnWidth(i + 1, 320);
    if (c[0] === 'thumb') sh.hideColumns(i + 1);
  });
  return sh;
}

function sheet_(key) {
  var sh = ss_().getSheetByName(TABS[key].name);
  if (!sh) throw appErr_('not_ready', '시트 탭 「' + TABS[key].name + '」이 없습니다.');
  return sh;
}

function header_(key) {
  _C.hdr = _C.hdr || {};
  if (_C.hdr[key]) return _C.hdr[key];
  var sh = sheet_(key);
  var n = sh.getLastColumn();
  var hdr = n ? sh.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  _C.hdr[key] = hdr;
  return hdr;
}

function readAll_(key) {
  _C.rows = _C.rows || {};
  if (_C.rows[key]) return _C.rows[key];
  var sh = sheet_(key), t = TABS[key], hdr = header_(key);
  var last = sh.getLastRow();
  var vals = (last >= 2 && hdr.length) ? sh.getRange(2, 1, last - 1, hdr.length).getValues() : [];
  var rows = [];
  vals.forEach(function (row, r) {
    var o = { _row: r + 2 };
    t.cols.forEach(function (c) {
      var i = hdr.indexOf(c[1]);
      o[c[0]] = i < 0 ? '' : fromCell_(row[i], c[2]);
    });
    if (String(o[t.cols[0][0]]) !== '') rows.push(o);
  });
  _C.rows[key] = rows;
  return rows;
}

// rowNum 0 = 맨 아래에 새 줄. 넘긴 키만 바꾸고 나머지 칸은 그대로 둔다.
function writeRow_(key, obj, rowNum) {
  var sh = sheet_(key), t = TABS[key], hdr = header_(key);
  var r = rowNum || sh.getLastRow() + 1;
  var row = rowNum ? sh.getRange(r, 1, 1, hdr.length).getValues()[0] : hdr.map(function () { return ''; });
  t.cols.forEach(function (c) {
    if (!Object.prototype.hasOwnProperty.call(obj, c[0])) return;
    var i = hdr.indexOf(c[1]);
    if (i >= 0) row[i] = toCell_(obj[c[0]], c[2]);
  });
  sh.getRange(r, 1, 1, hdr.length).setValues([row]);
  if (_C.rows) delete _C.rows[key];
  return r;
}

function toCell_(v, kind) {
  if (kind === 'n') return v === '' || v === null || v === undefined ? '' : Number(v) || 0;
  var s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@']/.test(s)) s = "'" + s; // 수식으로 해석되지 않게
  return s;
}

function fromCell_(v, kind) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (kind === 'd') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    if (kind === 'h') return Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  }
  if (kind === 'n') return v === '' ? '' : Number(v) || 0;
  var s = v === null || v === undefined ? '' : String(v);
  if (s.charAt(0) === "'") s = s.slice(1);
  return s;
}

function settings_() {
  if (_C.set) return _C.set;
  var s = {}, rows = [];
  if (ss_().getSheetByName(TABS.set.name)) rows = readAll_('set');
  var m = {};
  rows.forEach(function (r) { m[r.key] = r; });
  Object.keys(SET_KEYS).forEach(function (k) { var r = m[SET_KEYS[k][0]]; s[k] = r ? String(r.value) : ''; });
  s._rows = m;
  _C.set = s;
  return s;
}

function setSetting_(k, v) {
  var label = SET_KEYS[k][0];
  var r = settings_()._rows[label];
  writeRow_('set', { key: label, value: String(v), note: SET_KEYS[k][1] }, r ? r._row : 0);
  _C.set = null;
  _C.ready = undefined;
}

function teams_() {
  if (!ss_().getSheetByName(TABS.team.name)) return [];
  return readAll_('team').slice().sort(function (a, b) { return (Number(a.order) || 99) - (Number(b.order) || 99); });
}

function teamById_(id) { return find_(teams_(), String(id || '')); }

/* ───────── 팀별 보기 탭 ───────── */

// 팀마다 탭 하나(A-1팀 … C팀): 위에 예산·사용·잔액, 아래 왼쪽 활동 기록, 오른쪽 영수증.
// 수식으로 원본 탭(활동기록·영수증)에서 자동으로 채워지므로 사람이 고칠 곳은 아니다.
function buildTeamViews_() {
  var ss = ss_();
  var props = PropertiesService.getScriptProperties();
  var core = Object.keys(TABS).map(function (k) { return TABS[k].name; });
  var qa = "'" + TABS.act.name + "'!", qr = "'" + TABS.rcp.name + "'!", qt = "'" + TABS.team.name + "'!";
  var a = function (k) { return colOf_('act', k); }, r = function (k) { return colOf_('rcp', k); };
  teams_().forEach(function (t) {
    var name = String(t.name || t.id).slice(0, 90);
    if (core.indexOf(name) >= 0) name += ' 보기';
    var sid = props.getProperty('VIEW_' + t.id), sh = null;
    if (sid) sh = ss.getSheets().filter(function (x) { return String(x.getSheetId()) === sid; })[0] || null;
    if (!sh) sh = ss.getSheetByName(name) || ss.insertSheet(name, ss.getSheets().length);
    if (sh.getName() !== name && !ss.getSheetByName(name)) sh.setName(name);
    props.setProperty('VIEW_' + t.id, String(sh.getSheetId()));
    sh.clear();
    var id = '"' + t.id + '"';
    var used = 'SUMIFS(' + qr + '$' + r('amount') + ':$' + r('amount') + ', ' + qr + '$' + r('team') + ':$' + r('team') + ', ' + id
      + ', ' + qr + '$' + r('deleted') + ':$' + r('deleted') + ', "<>Y"';
    sh.getRange(1, 1).setValue(toCell_(t.name + ' (' + t.project + ') — 앱에 올린 기록이 자동으로 채워지는 보기 탭입니다. 여기서는 고치지 마세요.', 't')).setFontWeight('bold');
    sh.getRange(2, 1, 1, 10).setValues([['예산', '', '사용', '', '잔액', '', '확인 완료', '', '자율스터디', '']]);
    sh.getRange(2, 2).setFormula('=IFERROR(INDEX(' + qt + '$' + colOf_('team', 'budget') + ':$' + colOf_('team', 'budget') + ', MATCH(' + id + ', ' + qt + '$A:$A, 0)), 0)');
    sh.getRange(2, 4).setFormula('=' + used + ')');
    sh.getRange(2, 6).setFormula('=B2-D2');
    sh.getRange(2, 8).setFormula('=' + used + ', ' + qr + '$' + r('status') + ':$' + r('status') + ', "확인")');
    sh.getRange(2, 10).setFormula('=COUNTIFS(' + qa + '$' + a('team') + ':$' + a('team') + ', ' + id + ', ' + qa + '$' + a('type') + ':$' + a('type')
      + ', "자율스터디", ' + qa + '$' + a('deleted') + ':$' + a('deleted') + ', "<>Y")');
    [2, 4, 6, 8].forEach(function (c) { sh.getRange(2, c).setNumberFormat('#,##0"원"'); });
    sh.getRange(2, 10).setNumberFormat('0"회"');
    var actHdr = ['날짜', '유형', '시작', '종료', '시간', '장소', '참석자', '주제', '논의한 내용', '다음에 할 일', '작성자'];
    var rcpHdr = ['사용일', '금액', '사용처', '분류', '산 것', '결제한 사람', '결제 수단', '메모', '상태', '교육팀 메모'];
    var rc = actHdr.length + 2; // 활동 기록 오른쪽에 한 칸 띄우고 영수증
    sh.getRange(4, 1).setValue('활동 기록').setFontWeight('bold');
    sh.getRange(4, rc).setValue('영수증').setFontWeight('bold');
    sh.getRange(5, 1, 1, actHdr.length).setValues([actHdr]).setFontWeight('bold').setBackground('#e8eef8');
    sh.getRange(5, rc, 1, rcpHdr.length).setValues([rcpHdr]).setFontWeight('bold').setBackground('#e8eef8');
    sh.getRange(6, 1).setFormula('=IFERROR(SORT(FILTER(HSTACK(' + qa + a('date') + '2:' + a('date') + ', ' + qa + a('type') + '2:' + a('type') + ', '
      + qa + a('start') + '2:' + a('writer') + '), ' + qa + a('team') + '2:' + a('team') + '=' + id + ', ' + qa + a('deleted') + '2:' + a('deleted') + '<>"Y"), 1, TRUE), "")');
    sh.getRange(6, rc).setFormula('=IFERROR(SORT(FILTER(HSTACK(' + qr + r('date') + '2:' + r('item') + ', ' + qr + r('payer') + '2:' + r('method') + ', ' + qr + r('memo') + '2:' + r('reviewNote') + '), '
      + qr + r('team') + '2:' + r('team') + '=' + id + ', ' + qr + r('deleted') + '2:' + r('deleted') + '<>"Y"), 1, TRUE), "")');
    sh.getRange(6, rc + 1, Math.max(sh.getMaxRows() - 5, 1), 1).setNumberFormat('#,##0');
    sh.setFrozenRows(5);
    sh.setColumnWidth(9, 320); sh.setColumnWidth(10, 220); sh.setColumnWidth(rc + 4, 200); sh.setColumnWidth(rc + 7, 200); sh.setColumnWidth(rc + 8, 100); sh.setColumnWidth(rc + 9, 200);
  });
}

function colOf_(tab, key) {
  var i = TABS[tab].cols.map(function (c) { return c[0]; }).indexOf(key) + 1, s = '';
  if (i < 1) throw appErr_('server_error', '열 정의 없음: ' + tab + '.' + key);
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/* ───────── 파일(드라이브) ───────── */

// 시트에 쓰기 전에 파일을 모두 검사한다(중간에 거절돼 일부만 저장되는 일이 없게).
function checkFiles_(owner, newFiles, removeIds) {
  newFiles = Array.isArray(newFiles) ? newFiles : [];
  removeIds = (Array.isArray(removeIds) ? removeIds : []).map(String);
  var all = readAll_('file');
  var keep = live_(all).filter(function (f) { return f.owner === owner && removeIds.indexOf(f.id) < 0; }).length;
  var add = [];
  newFiles.forEach(function (nf) {
    var fid = cleanId_(nf.id, 'f');
    if (find_(all, fid)) return; // 재시도로 다시 온 파일(이미 저장됨)
    var mime = String(nf.mime || '');
    if (!OK_MIME.test(mime)) throw appErr_('bad_file', '사진(JPG·PNG 등) 또는 PDF만 올릴 수 있습니다.');
    var data = String(nf.data || '');
    if (!data || data.length > MAX_FILE_B64) throw appErr_('too_big', '파일이 너무 큽니다(9MB 이하).');
    add.push({ id: fid, mime: mime, data: data, thumb: String(nf.thumb || '') });
  });
  if (keep + add.length > MAX_FILES) throw appErr_('too_many', '사진·파일은 한 건에 ' + MAX_FILES + '개까지 올릴 수 있습니다.');
  return { add: add, remove: removeIds };
}

function applyFiles_(tid, owner, plan) {
  var all = readAll_('file');
  plan.remove.forEach(function (fid) {
    var f = find_(all, fid);
    if (!f || f.owner !== owner || f.deleted === 'Y') return;
    writeRow_('file', { deleted: 'Y' }, f._row);
    try { DriveApp.getFileById(f.driveId).setTrashed(true); } catch (e) { /* 이미 지워진 파일 */ }
  });
  plan.add.forEach(function (nf) {
    var bytes = Utilities.base64Decode(nf.data);
    var name = fileName_(owner, nf.id, nf.mime);
    var file = folder_(tid).createFile(Utilities.newBlob(bytes, nf.mime, name));
    var thumb = nf.thumb;
    if (thumb.length > MAX_THUMB || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(thumb)) thumb = '';
    writeRow_('file', { id: nf.id, team: tid, owner: owner, driveId: file.getId(), name: name, mime: nf.mime,
      size: bytes.length, created: now_(), deleted: '', thumb: thumb }, 0);
  });
  return live_(readAll_('file')).filter(function (f) { return f.owner === owner; }).map(pubFile_);
}

function trashOwner_(owner) {
  live_(readAll_('file')).filter(function (f) { return f.owner === owner; }).forEach(function (f) {
    writeRow_('file', { deleted: 'Y' }, f._row);
    try { DriveApp.getFileById(f.driveId).setTrashed(true); } catch (e) { /* 무시 */ }
  });
}

function fileName_(owner, fid, mime) {
  var ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' :
    /heic|heif/.test(mime) ? '.heic' : mime === 'image/gif' ? '.gif' : '.jpg';
  return (owner.indexOf('R:') === 0 ? '영수증_' : '활동_') + owner.slice(2) + '_' + fid.slice(-4) + ext;
}

function rootFolder_() {
  var S = settings_();
  if (S.folderId) { try { return DriveApp.getFolderById(S.folderId); } catch (e) { /* 새로 만든다 */ } }
  var f = DriveApp.createFolder('AI프론티어 팀 기록 (사진·영수증)');
  setSetting_('folderId', f.getId());
  return f;
}

function folder_(tid) {
  var props = PropertiesService.getScriptProperties();
  var key = 'FOLDER_' + tid;
  var id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 새로 만든다 */ } }
  var root = rootFolder_();
  var it = root.getFoldersByName(tid);
  var f = it.hasNext() ? it.next() : root.createFolder(tid);
  props.setProperty(key, f.getId());
  return f;
}

/* ───────── 밖으로 내보내는 모양 ───────── */

function pubSettings_(S) {
  return { courseName: S.courseName || 'AI프론티어', openActs: S.openActs === 'Y' ? 'Y' : 'N',
    studyGoal: Number(S.studyGoal) || 5, studyHours: Number(S.studyHours) || 4 };
}

function pubTeam_(t, withCode) {
  var o = { id: t.id, name: t.name, project: t.project, budget: Number(t.budget) || 0, members: splitList_(t.members) };
  if (withCode) o.code = String(t.code);
  return o;
}

function pubAct_(a) {
  return { id: a.id, team: a.team, type: a.type, date: a.date, start: a.start, end: a.end, hours: Number(a.hours) || 0,
    place: a.place, attendees: splitList_(a.attendees), topic: a.topic, content: a.content, next: a.next,
    writer: a.writer, created: a.created, updated: a.updated };
}

function pubRcp_(r) {
  return { id: r.id, team: r.team, date: r.date, amount: Number(r.amount) || 0, store: r.store, category: r.category,
    item: r.item, people: Number(r.people) || 0, payer: r.payer, method: r.method, actId: r.actId, memo: r.memo,
    status: r.status || '제출', reviewNote: r.reviewNote, reviewed: r.reviewed, writer: r.writer,
    created: r.created, updated: r.updated };
}

function pubFile_(f) {
  return { id: f.id, team: f.team, owner: f.owner, name: f.name, mime: f.mime, size: Number(f.size) || 0,
    thumb: f.thumb, created: f.created };
}

/* ───────── 작은 도구 ───────── */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var keepSs = _C.ss;
    _C = { ss: keepSs }; // 잠금 안에서는 시트를 새로 읽는다
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function log_(who, action, target, summary) {
  try {
    writeRow_('log', { at: now_(), who: who.label || '', action: action, target: target || '', summary: String(summary || '').slice(0, 300) }, 0);
  } catch (e) { /* 기록 실패는 무시 */ }
}

function live_(rows) { return rows.filter(function (r) { return r.deleted !== 'Y'; }); }
function find_(rows, id) { for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id && id !== '') return rows[i]; return null; }
function merge_(a, b) { var o = {}, k; for (k in (a || {})) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function round2_(n) { return Math.round(n * 100) / 100; }

function maskName_(n) {
  var s = String(n || '').trim();
  if (s.length <= 1) return s;
  if (s.length === 2) return s.charAt(0) + '○';
  return s.charAt(0) + new Array(s.length - 1).join('○') + s.charAt(s.length - 1);
}

function str_(v, max) {
  var s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return s.slice(0, max);
}

function num_(v, min, max) {
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, ''));
  if (!isFinite(n)) n = 0;
  return Math.min(Math.max(n, min), max);
}

function list_(v, max) {
  var arr = Array.isArray(v) ? v : String(v || '').split(/[,\n]/);
  var out = [];
  arr.forEach(function (x) {
    var s = str_(x, 30).replace(/,/g, ' ');
    if (s && out.indexOf(s) < 0 && out.length < max) out.push(s);
  });
  return out;
}

function splitList_(s) { return list_(s, 60); }

function date_(v) {
  var s = String(v || '').trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || +m[1] < 2020 || +m[1] > 2100) return '';
  return s;
}

function time_(v) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return '';
  return ('0' + (+m[1])).slice(-2) + ':' + m[2];
}

function hoursBetween_(a, b) {
  var p = a.split(':'), q = b.split(':');
  var mins = (+q[0] * 60 + +q[1]) - (+p[0] * 60 + +p[1]);
  if (mins <= 0) mins += 24 * 60;
  return round2_(mins / 60);
}

function cleanId_(v, prefix) {
  var s = String(v || '');
  if (new RegExp('^' + prefix + '_[A-Za-z0-9]{6,32}$').test(s)) return s;
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function newCode_(taken) {
  for (var i = 0; i < 100; i++) {
    var c = String(100000 + Math.floor(Math.random() * 900000));
    if (taken.indexOf(c) < 0) return c;
  }
  throw appErr_('server_error', '코드를 만들 수 없습니다.');
}
