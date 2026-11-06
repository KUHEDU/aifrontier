/**
 * AI프론티어 팀 활동·영수증 — 구글 시트 연결 스크립트 (Google Apps Script)
 *
 * 설치(교육팀 1회, 약 10분)
 *  1) 구글 드라이브에서 새 스프레드시트를 만든다. (이름 예: AI프론티어 팀 기록)
 *  2) 메뉴 [확장 프로그램 → Apps Script] → 기본 코드를 모두 지우고 이 파일 전체를 붙여 넣고 저장.
 *  3) [배포 → 새 배포 → 유형: 웹 앱] → 실행: 나 / 액세스 권한이 있는 사용자: 모든 사용자 → 배포 → 권한 허용.
 *  4) 나온 웹 앱 URL(…/exec)을 앱의 [교육팀 설정] 화면에 붙여 넣는다. 탭·팀 코드·사진 폴더가 자동으로 만들어진다.
 *  5) (새 기록 알림 메일) 편집기 위쪽에서 함수 setupNotify 를 골라 [실행] → 권한 허용. 팀이 기록을 남기면 몇 분 안에
 *     내 메일로 알림이 온다. 받는 주소 바꾸기·끄기는 관리자 화면 → 설정.
 *
 * 데이터는 이 시트의 탭(설정·팀·활동기록·영수증·일정·파일·변경이력)에, 사진·영수증 파일은 내 드라이브의
 * 「AI프론티어 팀 기록 (사진·영수증)」 폴더에 쌓인다. 팀 코드가 맞아야만 읽고 쓸 수 있다.
 * 영수증은 따로 올리지 않고 활동 기록에 붙인다(영수증 탭의 「연결활동」 칸 = 활동 id).
 * 팀이 미리 정해 두는 스터디·멘토링 일정은 「일정」 탭에 쌓인다(이 탭이 없던 시트는 첫 일정을 저장할 때 만든다).
 * 일정에 「공가 지원 요청」을 체크하면 교육팀 승인을 거친다(승인상태: 대기 → 승인 또는 보완요청). 승인된 일정은 공가 증빙으로 쓴다.
 * 코드를 고친 뒤에는 [배포 → 배포 관리 → 편집(연필) → 버전: 새 버전 → 배포]를 해야 반영된다(URL은 그대로).
 */

var VERSION = '2026-11-06.1';
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
var EV_STATUS = ['대기', '승인', '보완요청']; // 공가 지원 요청 일정의 승인 상태
var MAX_FILES = 4;
var MAX_FILE_B64 = 12 * 1024 * 1024;   // base64 길이 기준(원본 약 9MB)
var MAX_THUMB = 45000;                 // 시트 셀 한도 50,000자
var FAIL_LIMIT = 20;                   // 10분 안에 20번 틀리면
var FAIL_WINDOW = 600;                 // 10분 잠금
var OK_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;
var APP_URL = 'https://kuhedu.github.io/aifrontier/';
var NOTIFY_EVERY = 5;                  // 분마다 변경이력을 본다(시간 트리거)
var NOTIFY_QUIET = 2 * 60 * 1000;      // 마지막 저장 뒤 2분 조용해지면 보낸다(활동과 영수증을 한 통으로)
var NOTIFY_MAX_WAIT = 15 * 60 * 1000;  // 저장이 계속 이어져도 15분이 넘으면 보낸다
var NOTIFY_MAX_LINES = 60;

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
  ev: { name: '일정', cols: [['id', 'id', 't'], ['team', '팀ID', 't'], ['type', '유형', 't'], ['date', '날짜', 'd'],
    ['start', '시작', 'h'], ['end', '종료', 'h'], ['title', '제목', 't'], ['place', '장소', 't'], ['memo', '메모', 't'],
    ['writer', '작성자', 't'], ['created', '작성시각', 's'], ['updated', '수정시각', 's'], ['deleted', '삭제', 't'],
    ['leave', '공가요청', 't'], ['people', '공가대상', 't'], ['status', '승인상태', 't'], ['reviewNote', '확인메모', 't'],
    ['reviewed', '승인시각', 's'], ['actId', '활동기록', 't']] }, // 11-06에 붙인 열은 끝에 둔다(ensureCols_)
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
  notifyEmail: ['알림메일', '팀이 기록을 남기면 알림을 받을 메일 주소(여러 개는 쉼표, 비우면 보내지 않음)'],
  createdAt: ['만든시각', '처음 설정한 시각']
};

var ROUTES = {
  ping: ping_, setup: setup_, load: load_,
  saveAct: saveAct_, deleteAct: deleteAct_,
  saveRcp: saveRcp_, deleteRcp: deleteRcp_,
  saveEvent: saveEvent_, deleteEvent: deleteEvent_, reviewEvent: reviewEvent_,
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
  var evs = live_(evRows_());
  var res = { settings: pubSettings_(S) };
  if (who.admin) {
    res.role = 'admin';
    res.teams = teams.map(function (t) { return pubTeam_(t, true); });
    res.acts = acts.map(pubAct_);
    res.rcps = rcps.map(pubRcp_);
    res.files = files.map(pubFile_);
    res.events = evs.map(pubEv_);
    res.sheetUrl = ss_().getUrl();
    res.folderUrl = S.folderId ? 'https://drive.google.com/drive/folders/' + S.folderId : '';
    res.notify = notifyInfo_(S);
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
  res.events = evs.filter(function (e) { return e.team === tid; }).map(pubEv_); // 일정은 활동기록공개와 관계없이 자기 팀만
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
    var linked = null;
    var ev = req.evId ? find_(evRows_(), str_(req.evId, 40)) : null;
    if (ev && ev.deleted !== 'Y' && ev.team === tid) { // 일정에서 쓴 활동 기록: 그 일정과 잇는다(공가 증빙에 함께 들어감)
      if (ev.actId !== id) { ensureCols_('ev'); writeRow_('ev', { actId: id }, ev._row); }
      linked = pubEv_(merge_(ev, { actId: id }));
    }
    return { act: pubAct_(merge_(ex, obj)), files: files, event: linked };
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

// 팀 일정(스터디·멘토링 등). 팀은 자기 팀 것만, 교육팀은 어느 팀 것이든 만들고 고친다
function saveEvent_(req) {
  var who = auth_(req);
  var e = req.event || {};
  return withLock_(function () {
    var tid = who.admin ? str_(e.team, 10) : who.team.id;
    if (!teamById_(tid)) throw appErr_('bad', '팀을 찾을 수 없습니다.');
    var date = date_(e.date);
    if (!date) throw appErr_('bad', '날짜를 확인해 주세요.');
    var start = time_(e.start), end = start ? time_(e.end) : '';
    var title = str_(e.title, 100), place = str_(e.place, 100), people = list_(e.people, 40);
    var leave = e.leave === true || e.leave === 'Y';
    if (leave) { // 공가 증빙에 꼭 있어야 하는 칸
      if (!start || !end) throw appErr_('bad', '공가 지원 요청은 시작·종료 시각을 넣어 주세요.');
      if (!place) throw appErr_('bad', '공가 지원 요청은 장소를 넣어 주세요.');
      if (!title) throw appErr_('bad', '공가 지원 요청은 학습 주제를 넣어 주세요.');
      if (!people.length) throw appErr_('bad', '공가 지원 대상자를 한 명 이상 골라 주세요.');
    }
    ensureCols_('ev');
    var id = cleanId_(e.id, 'e');
    var ex = find_(readAll_('ev'), id);
    if (ex && ex.team !== tid) throw appErr_('forbidden', '다른 팀의 일정입니다.');
    if (ex && ex.deleted === 'Y') throw appErr_('deleted', '이미 지운 일정입니다.');
    var now = now_();
    var obj = {
      id: id, team: tid, type: ACT_TYPES.indexOf(e.type) >= 0 ? e.type : '기타', date: date, start: start, end: end,
      title: title, place: place, memo: str_(e.memo, 2000), writer: str_(e.writer, 30), updated: now, deleted: '',
      leave: leave ? 'Y' : '', people: leave ? people.join(', ') : ''
    };
    if (!ex) obj.created = now;
    // 승인 상태: 공가 요청이 아니면 비움. 팀이 고치면 다시 승인 대기(내용이 그대로면 승인 유지), 교육팀이 처음 공가로 정하면 바로 승인
    var same = !!ex && ex.leave === 'Y' && ['type', 'date', 'start', 'end', 'title', 'place', 'memo', 'people'].every(function (k) { return String(ex[k]) === String(obj[k]); });
    if (!leave) { obj.status = ''; obj.reviewed = ''; obj.reviewNote = ''; }
    else if (who.admin) { if (!ex || ex.leave !== 'Y' || !ex.status) { obj.status = '승인'; obj.reviewed = now; } }
    else if (!(same && ex.status === '승인')) { obj.status = '대기'; obj.reviewed = ''; }
    writeRow_('ev', obj, ex ? ex._row : 0);
    log_(who, ex ? '일정 수정' : '일정 등록', id, obj.date + ' ' + obj.type + ' ' + obj.title + (leave ? ' (공가 요청)' : ''));
    return { event: pubEv_(merge_(ex, obj)) };
  });
}

function deleteEvent_(req) {
  var who = auth_(req);
  return withLock_(function () {
    var ex = find_(evRows_(), String(req.id || ''));
    if (!ex || ex.deleted === 'Y') return { deleted: true };
    if (!who.admin && ex.team !== who.team.id) throw appErr_('forbidden', '다른 팀의 일정입니다.');
    if (!who.admin && ex.leave === 'Y' && ex.status === '승인') throw appErr_('locked', '교육팀이 승인한 공가 일정은 지울 수 없습니다. 교육팀에 알려 주세요.');
    writeRow_('ev', { deleted: 'Y', updated: now_() }, ex._row);
    log_(who, '일정 삭제', ex.id, ex.date + ' ' + ex.type + ' ' + ex.title);
    return { deleted: true };
  });
}

// 공가 지원 요청 일정을 교육팀이 승인·보완 요청하거나 승인 대기로 되돌린다
function reviewEvent_(req) {
  var who = auth_(req);
  if (!who.admin) throw appErr_('forbidden', '교육팀만 할 수 있습니다.');
  return withLock_(function () {
    var ex = find_(evRows_(), String(req.id || ''));
    if (!ex || ex.deleted === 'Y') throw appErr_('not_found', '일정을 찾을 수 없습니다.');
    if (ex.leave !== 'Y') throw appErr_('bad', '공가 지원 요청이 아닌 일정입니다.');
    var status = EV_STATUS.indexOf(req.status) >= 0 ? req.status : '대기';
    var obj = { status: status, reviewNote: str_(req.note, 500), reviewed: status === '대기' ? '' : now_() };
    ensureCols_('ev');
    writeRow_('ev', obj, ex._row);
    log_(who, '공가 ' + (status === '대기' ? '승인 대기로' : status), ex.id, ex.date + ' ' + ex.title + ' ' + obj.reviewNote);
    return { event: pubEv_(merge_(ex, obj)) };
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
    if (s.notifyEmail !== undefined) {
      var to = emails_(s.notifyEmail, true);
      var before = settings_().notifyEmail;
      setSetting_('notifyEmail', to.join(', '));
      if (to.length) {
        ensureNotifyTrigger_();
        if (to.join(', ') !== before) sendHello_(to); // 새 주소로 바로 한 통 보내 확인할 수 있게
      }
    }
    log_(who, '설정 저장', '', JSON.stringify(s.adminCode ? { adminCode: '변경' } : s).slice(0, 200));
    var S2 = settings_();
    return { settings: pubSettings_(S2), notify: notifyInfo_(S2) };
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

// 탭이 없으면 만들고, 있으면 머리글에 없는 열만 오른쪽 끝에 붙인다(먼저 만든 시트를 그대로 쓰려고)
function ensureCols_(key) {
  var ss = ss_(), t = TABS[key], sh = ss.getSheetByName(t.name);
  if (!sh) { ensureTab_(ss, key); if (_C.hdr) delete _C.hdr[key]; return; }
  var hdr = header_(key);
  var add = t.cols.filter(function (c) { return hdr.indexOf(c[1]) < 0; });
  if (!add.length) return;
  var c0 = hdr.length + 1, rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(1, c0, 1, add.length).setValues([add.map(function (c) { return c[1]; })]).setFontWeight('bold').setBackground('#e8eef8');
  add.forEach(function (c, i) { sh.getRange(2, c0 + i, rows, 1).setNumberFormat(c[2] === 'n' ? '#,##0' : '@'); });
  delete _C.hdr[key];
  if (_C.rows) delete _C.rows[key];
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

// 「일정」 탭은 2026-11-05에 생겼다. 그 전에 설치한 시트에는 없으니 없으면 빈 목록(저장할 때 만든다)
function evRows_() { return ss_().getSheetByName(TABS.ev.name) ? readAll_('ev') : []; }

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

/* ───────── 새 기록 알림 메일 ───────── */

// 편집기에서 한 번 실행한다: 메일 보내기·트리거 권한을 허용하고, 받는 주소가 비어 있으면 내 계정 메일로 켠다.
function setupNotify() {
  return withLock_(function () {
    var to = emails_(settings_().notifyEmail);
    if (!to.length) { to = [Session.getEffectiveUser().getEmail()]; setSetting_('notifyEmail', to.join(', ')); }
    ensureNotifyTrigger_();
    sendHello_(to);
    log_({ label: '설치' }, '알림 메일 켬', '', to.join(', '));
    console.log('새 기록 알림 메일을 켰습니다: ' + to.join(', '));
    return to.join(', ');
  });
}

// 시간 트리거(NOTIFY_EVERY분마다)가 부른다. 저장 중이면 다음 차례로 미룬다.
function notifyTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try { _C = {}; notify_(Date.now()); }
  finally { lock.releaseLock(); }
}

// 변경이력에서 지난번 뒤로 팀이 남긴 줄만 모아 메일 한 통으로 보낸다. 교육팀이 한 일은 보내지 않는다.
function notify_(now) {
  var props = PropertiesService.getScriptProperties();
  var last = sheet_('log').getLastRow();
  var done = Number(props.getProperty('NOTIFY_ROW') || 0);
  if (!done || done > last) { props.setProperty('NOTIFY_ROW', String(last)); return 0; } // 처음이거나 이력 줄을 지웠으면 여기서부터
  if (last === done) return 0;
  var rows = readAll_('log').filter(function (r) {
    return r._row > done && r._row <= last && ['교육팀', '설치', ''].indexOf(String(r.who)) < 0;
  });
  var to = emails_(settings_().notifyEmail);
  if (!rows.length || !to.length) { props.setProperty('NOTIFY_ROW', String(last)); return 0; }
  var times = rows.map(function (r) { return atMs_(r.at); });
  var newest = Math.max.apply(null, times), oldest = Math.min.apply(null, times);
  if (now - newest < NOTIFY_QUIET && now - oldest < NOTIFY_MAX_WAIT) return 0; // 아직 저장이 이어지는 중
  if (MailApp.getRemainingDailyQuota() < to.length) return 0; // 하루 한도: 내일 이어서
  var mail = notifyMail_(rows, now);
  if (mail) MailApp.sendEmail({ to: to.join(','), name: mailName_(), subject: mail.subject, body: mail.body });
  props.setProperty('NOTIFY_ROW', String(last));
  return mail ? rows.length : 0;
}

function notifyMail_(rows, now) {
  var course = settings_().courseName || 'AI프론티어';
  var acts = readAll_('act'), rcps = readAll_('rcp'), evs = evRows_();
  var rank = {};
  teams_().forEach(function (t, i) { rank[t.name] = i; });
  var groups = {}, labels = [];
  rows.forEach(function (r) {
    var g = groups[r.who];
    if (!g) { g = groups[r.who] = { act: {}, actIds: [], rcp: {}, rcpIds: [], ev: {}, evIds: [], members: null }; labels.push(r.who); }
    if (r.action === '팀원 수정') { g.members = r.summary; return; }
    var kind = /^활동 /.test(r.action) ? 'act' : /^영수증 /.test(r.action) ? 'rcp' : /^일정 /.test(r.action) ? 'ev' : '';
    if (!kind || !r.target) return;
    var e = g[kind][r.target];
    if (!e) { e = g[kind][r.target] = { isNew: false, del: false, summary: '' }; g[kind + 'Ids'].push(r.target); }
    if (/ (등록|제출)$/.test(r.action)) e.isNew = true;
    e.del = / 삭제$/.test(r.action);
    e.summary = r.summary;
  });
  labels.sort(function (a, b) { return (a in rank ? rank[a] : 99) - (b in rank ? rank[b] : 99); });
  var lines = [], shown = [], n = { act: 0, rcp: 0, ev: 0, lv: 0, mem: 0 };
  labels.forEach(function (label) {
    var g = groups[label], used = {}, out = [];
    g.actIds.forEach(function (id) {
      var e = g.act[id];
      n.act++;
      out.push('- ' + (e.del ? '활동 기록 삭제' : e.isNew ? '새 활동 기록' : '활동 기록 고침') + ': ' + actLine_(find_(acts, id), e));
      g.rcpIds.forEach(function (rid) { // 이 활동에 붙은 영수증은 활동 아래에
        var x = find_(rcps, rid);
        if (!x || x.actId !== id) return;
        used[rid] = true;
        n.rcp++;
        out.push('    · ' + rcpLine_(x, g.rcp[rid], null));
      });
    });
    g.rcpIds.forEach(function (rid) {
      if (used[rid]) return;
      var x = find_(rcps, rid);
      n.rcp++;
      out.push('- ' + rcpLine_(x, g.rcp[rid], x ? find_(acts, x.actId) : null));
    });
    g.evIds.forEach(function (id) {
      var e = g.ev[id], x = find_(evs, id), lv = !!x && x.leave === 'Y';
      n.ev++;
      if (lv && !e.del) n.lv++;
      out.push('- ' + (e.del ? '일정 삭제' : e.isNew ? '새 일정' : '일정 고침') + (lv ? '(공가 요청)' : '') + ': ' + evLine_(x, e));
    });
    if (g.members !== null) { n.mem++; out.push('- 팀원 수정: ' + (g.members || '(모두 지움)')); }
    if (!out.length) return;
    shown.push(label);
    lines.push('', '[' + label + ']');
    Array.prototype.push.apply(lines, out);
  });
  if (!shown.length) return null;
  if (lines.length > NOTIFY_MAX_LINES) {
    var more = lines.length - NOTIFY_MAX_LINES;
    lines = lines.slice(0, NOTIFY_MAX_LINES).concat(['', '… 나머지 ' + more + '줄은 관리자 화면에서 확인해 주세요.']);
  }
  var parts = [];
  if (n.act) parts.push('활동 기록 ' + n.act + '건');
  if (n.rcp) parts.push('영수증 ' + n.rcp + '건');
  if (n.ev) parts.push('일정 ' + n.ev + '건' + (n.lv ? '(공가 요청 ' + n.lv + '건)' : ''));
  if (n.mem) parts.push('팀원 수정');
  var at = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd HH:mm');
  return {
    subject: '[' + course + '] ' + shown.join('·') + ' — ' + parts.join(', '),
    body: course + ' 팀이 남긴 새 기록입니다(' + md_(at.slice(0, 10)) + ' ' + at.slice(11) + ' 기준).\n' + lines.join('\n') + '\n\n' + mailFooter_()
  };
}

function actLine_(a, e) {
  if (!a) return e.summary;
  var s = md_(a.date) + ' ' + (a.type || '') + ' 「' + (a.topic || '주제 없음') + '」';
  if (Number(a.hours)) s += ' ' + round2_(Number(a.hours)) + '시간';
  if (a.writer) s += ' · 작성 ' + a.writer;
  var m = /\(영수증 \d+건 함께\)/.exec(e.summary || '');
  if (e.del && m) s += ' ' + m[0];
  return s;
}

function rcpLine_(x, e, act) {
  var del = e.del || (x && x.deleted === 'Y');
  var head = del ? '영수증 뺌' : e.isNew ? '영수증 제출' : (x && x.status === '제출' && x.reviewNote ? '영수증 다시 제출(보완 요청 뒤)' : '영수증 고침');
  if (!x) return head + ': ' + e.summary;
  var s = head + ': ' + x.store + ' ' + won_(x.amount) + ' (' + md_(x.date) + (x.payer ? ', 결제 ' + x.payer : '') + ')';
  if (act) s += ' — 활동 ' + md_(act.date) + ' 「' + (act.topic || '주제 없음') + '」';
  return s;
}

function evLine_(x, e) {
  if (!x) return e.summary;
  var s = md_(x.date) + (x.start ? ' ' + x.start + (x.end ? '–' + x.end : '') : '') + ' ' + (x.type || '') + (x.title ? ' 「' + x.title + '」' : '');
  if (x.place) s += ' · ' + x.place;
  if (x.leave === 'Y') s += ' · 대상 ' + splitList_(x.people).length + '명';
  if (x.writer) s += ' · 작성 ' + x.writer;
  return s;
}

function sendHello_(to) {
  MailApp.sendEmail({ to: to.join(','), name: mailName_(), subject: '[' + (settings_().courseName || 'AI프론티어') + '] 새 기록 알림 메일을 켰습니다',
    body: '앞으로 팀이 활동 기록·영수증·일정을 남기거나 고치면 몇 분 안에 이 주소로 알림 메일을 보냅니다.\n'
      + '받는 주소: ' + to.join(', ') + '\n\n' + mailFooter_() });
}

function mailFooter_() {
  return '관리자 화면: ' + APP_URL + '#admin\n\n'
    + '팀이 기록을 남기거나 고치면 몇 분 안에 자동으로 보내는 메일입니다.\n'
    + '받는 주소 바꾸기·끄기: 관리자 화면 → 설정 → 새 기록 알림 메일';
}

function mailName_() { return (settings_().courseName || 'AI프론티어') + ' 팀 기록'; }

// 트리거가 없으면 만들고, 그때부터 쌓인 이력만 보내도록 기준 줄을 지금 끝 줄로 맞춘다.
function ensureNotifyTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'notifyTick'; });
  if (has) return;
  PropertiesService.getScriptProperties().setProperty('NOTIFY_ROW', String(sheet_('log').getLastRow()));
  ScriptApp.newTrigger('notifyTick').timeBased().everyMinutes(NOTIFY_EVERY).create();
}

// on: 트리거가 있으면 true, 없으면 false, 권한이 없어 알 수 없으면 null
function notifyInfo_(S) {
  var on = null;
  try { on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'notifyTick'; }); } catch (e) { on = null; }
  return { email: S.notifyEmail || '', on: on };
}

// 쉼표·공백으로 나눈 메일 주소. strict 이면 틀린 주소에서 멈추고, 아니면 틀린 주소는 건너뛴다.
function emails_(v, strict) {
  var out = [];
  String(v || '').split(/[,;\s]+/).forEach(function (x) {
    if (!x) return;
    if (x.length > 100 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) {
      if (strict) throw appErr_('bad', '메일 주소를 확인해 주세요: ' + x.slice(0, 60));
      return;
    }
    if (out.indexOf(x) < 0) out.push(x);
  });
  if (strict && out.length > 5) throw appErr_('bad', '알림 메일 주소는 5개까지 넣을 수 있습니다.');
  return out.slice(0, 5);
}

function atMs_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]) : 0; // 시트 시각은 한국 시간
}

function md_(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return String(d || '');
  return (+m[2]) + '.' + (+m[3]) + '(' + '일월화수목금토'.charAt(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()) + ')';
}

function won_(v) { return String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; }

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

function pubEv_(e) {
  return { id: e.id, team: e.team, type: e.type, date: e.date, start: e.start, end: e.end, title: e.title, place: e.place,
    memo: e.memo, writer: e.writer, created: e.created, updated: e.updated, leave: e.leave === 'Y', people: splitList_(e.people),
    status: e.leave === 'Y' ? e.status || '대기' : '', reviewNote: e.reviewNote || '', reviewed: e.reviewed || '', actId: e.actId || '' };
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
