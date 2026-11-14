/* 지렁이 대작전 — 세계·몸·충돌·먹이·컴퓨터 지렁이 (worm/core.js)
   화면과 상관없는 부분만 모았다. 브라우저(window.WormCore)와 노드(tools/worm/test.js) 양쪽에서 같은 코드를 쓴다.
   - 1/60초 고정 스텝. 난수는 모두 시드 난수(G.rng) — 같은 시드·같은 입력이면 결과가 똑같다.
   - 둥근 경기장(반지름 ARENA). 지렁이 몸 = 머리가 지나간 길(4 단위 간격으로 적은 자취)을 따라 늘어선 마디.
     마디 간격은 굵기의 0.6배라 몸이 매끈하게 이어지고, 꺾인 길도 그대로 따라온다.
   - 충돌: 마디를 64 단위 칸(공간 해시)에 넣고, 머리 근처 칸만 본다. 내 몸에는 부딪히지 않는다(남의 몸·머리·벽만).
   - 자취·마디 배열(Float32Array)은 크기별 풀에서 빌려 쓰고 죽으면 돌려준다(가비지 없이 계속 돈다).
   - 먹이도 128 단위 칸에 넣어 머리 근처만 본다. 가까운 먹이는 머리 쪽으로 빨려 온다.
   - 부스트: 두 배 빠르게, 대신 길이가 줄고 줄어든 길이의 70%가 꼬리 뒤에 먹이로 떨어진다.
   - 죽으면 길이의 75%가 몸을 따라 커다란 빛 먹이로 흩어진다. */
(function (root, factory) {
  var C = factory();
  if (typeof module === 'object' && module.exports) module.exports = C; else root.WormCore = C;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var STEP = 1 / 60, ARENA = 2800, CELL = 64, OCELL = 128, TD = 4;
var BASE_V = 225, BOOST_V = 470, MIN_BOOST = 30, START_M = 20;
var BOOST_DROP = 0.7, DEATH_DROP = 0.75, ORB_CAP = 6000, MAX_SEG_R = 44;
var TAU = Math.PI * 2;
var GN = Math.ceil(ARENA * 2 / CELL), OGN = Math.ceil(ARENA * 2 / OCELL);

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function wrapA(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function rng(seed) {
  var s = (seed >>> 0) || 1;
  var f = function () { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return f;
}
/* 길이(질량) → 굵기·몸 길이·마디 */
function radius(m) { return Math.min(MAX_SEG_R, 7 + Math.sqrt(Math.max(0, m)) * 0.25); }
function bodyLen(m) { return Math.min(TD * 2000, 15 * Math.pow(Math.max(1, m), 0.55)); }
function spacing(r) { return r * 0.6; }
function segCount(m) { return Math.max(4, Math.ceil(bodyLen(m) / spacing(radius(m))) + 1); }
function turnRate(r) { return 4.4 / (1 + (r - 7) / 22); }
function boostCost(m) { return 5 + m * 0.011; }        // 초당 줄어드는 길이
function pow2(n) { var c = 16; while (c < n) c <<= 1; return c; }

/* ── 배열 풀 ── */
var POOL = {}, POOL_NEW = 0, POOL_REUSE = 0;
function getArr(cap) { var l = POOL[cap]; if (l && l.length) { POOL_REUSE++; return l.pop(); } POOL_NEW++; return new Float32Array(cap); }
function putArr(a) { if (!a) return; (POOL[a.length] || (POOL[a.length] = [])).push(a); }
function poolStats() { var n = 0; for (var k in POOL) n += POOL[k].length; return { created: POOL_NEW, reused: POOL_REUSE, idle: n }; }

/* ── 무늬(스킨): 최고 길이로 열린다. 그림은 game.js 가 이 색으로 그린다 ── */
var SKINS = [
  { id: 'sprout', name: '새싹', need: 0, cols: ['#86e86f', '#53c24b'], seq: [0, 0, 1] },
  { id: 'milk', name: '딸기우유', need: 0, cols: ['#ffb0cd', '#fff1f6'], seq: [0, 0, 1, 1] },
  { id: 'sea', name: '바닷물', need: 150, cols: ['#2f9dff', '#35d3e6', '#8af2ff'], seq: [0, 1, 2, 1] },
  { id: 'bee', name: '꿀벌', need: 400, cols: ['#ffd23f', '#2b2218'], seq: [0, 0, 0, 1, 1] },
  { id: 'melon', name: '수박', need: 800, cols: ['#36a547', '#16501f'], seq: [0, 0, 1], dot: '#0f3416' },
  { id: 'rainbow', name: '무지개', need: 1300, rainbow: true, cols: ['#ff5a5a'] },
  { id: 'lava', name: '용암', need: 2000, cols: ['#ff3b1f', '#ff8a1f', '#ffd23f', '#ff8a1f'], seq: [0, 1, 2, 3] },
  { id: 'galaxy', name: '은하수', need: 3000, cols: ['#2c1d62', '#45308c'], seq: [0, 1], dot: '#ffffff' },
  { id: 'zebra', name: '얼룩말', need: 4500, cols: ['#f4f4f4', '#1e1e24'], seq: [0, 0, 1] },
  { id: 'gold', name: '황금 지렁이', need: 7000, cols: ['#ffe27a', '#f2b632', '#c98a12'], seq: [0, 1, 2, 1], dot: '#fffbe0' },
  /* 길이 말고 다른 기록으로 여는 무늬(req = [기록 이름, 필요한 값]). 모두 플레이 기록으로만 열린다(결제 없음) */
  { id: 'mint', name: '민트초코', need: 0, req: ['games', 10], cols: ['#8ce3c8', '#5b3a29'], seq: [0, 0, 1], dot: '#3b2418' },
  { id: 'tiger', name: '호랑이', need: 0, req: ['bestKills', 5], cols: ['#ff9f1c', '#1d1d1d'], seq: [0, 0, 0, 1] },
  { id: 'neon', name: '네온사인', need: 0, req: ['tbest', 1000], cols: ['#ff4fd8', '#3df5ff', '#b6ff3d'], seq: [0, 1, 2] },
  { id: 'moon', name: '달빛', need: 0, req: ['dDays', 3], cols: ['#1b2550', '#2b3a78'], seq: [0, 1], dot: '#fff3b0' }
];
function skinById(id) { for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i]; return SKINS[0]; }
/* 최고 길이만으로 열린 무늬(예전과 같은 결과) */
function unlocked(best) { return SKINS.filter(function (s) { return !s.req && best >= s.need; }).map(function (s) { return s.id; }); }
/* 기록 전체(rec = {best, games, bestKills, tbest, dDays})로 열린 무늬 */
function unlockedRec(rec) { return SKINS.filter(function (s) { return s.req ? (rec[s.req[0]] || 0) >= s.req[1] : (rec.best || 0) >= s.need; }).map(function (s) { return s.id; }); }

/* ── 모드 ── classic = 예전 그대로(한 목숨, 시간 제한 없음, 순위 'worm').
   time = 3분 동안 최대 길이(죽어도 다시 태어남, 순위 'worm-t3').
   daily = 날짜로 정한 같은 시드·같은 규칙, 3분 한 목숨(순위 'worm-dYYYYMMDD') */
var MODES = {
  classic: { name: '자유 대전', limit: 0, respawn: false },
  time: { name: '3분 타임어택', limit: 180, respawn: true, orbMul: 1.25 },
  daily: { name: '오늘의 도전', limit: 180, respawn: false },
  online: { name: '온라인 멀티', limit: 0, respawn: true }
};
/* 오늘의 도전 규칙: 날짜마다 하나 */
var DAILY = [
  { id: 'feast', name: '먹이 잔치', desc: '경기장에 먹이가 1.6배 많아요', orbMul: 1.6 },
  { id: 'hunters', name: '사냥꾼 소굴', desc: '컴퓨터 지렁이가 모두 사냥꾼이에요', types: ['hunter'] },
  { id: 'giants', name: '거인의 경기장', desc: '처음부터 큰 컴퓨터 지렁이가 많아요', botMass: 2.2 },
  { id: 'crowd', name: '북적북적', desc: '컴퓨터 지렁이가 28마리예요', bots: 28 },
  { id: 'gold', name: '황금 먹이', desc: '흩어진 먹이가 모두 두 배로 커요', orbVal: 2 },
  { id: 'calm', name: '느긋한 날', desc: '먹보·겁쟁이만 나와요(사냥꾼 없음)', types: ['forager', 'coward'] },
  { id: 'big', name: '큰 지렁이로 시작', desc: '내 지렁이가 길이 80으로 시작해요', start: 80 }
];
function dailySeed(day) {
  var s = 2166136261 >>> 0, t = 'worm' + day;
  for (var i = 0; i < t.length; i++) { s ^= t.charCodeAt(i); s = Math.imul(s, 16777619) >>> 0; }
  s ^= s >>> 16; s = Math.imul(s, 0x85ebca6b) >>> 0; s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35) >>> 0; s ^= s >>> 16;
  return s >>> 0;
}
/* 규칙은 날짜 순서대로 돌아가며(7일이면 모두 한 번씩) — 'YYYYMMDD' → 1970-01-01 부터 며칠째 */
function dailyRule(day) {
  day = String(day);
  var n = Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)) / 86400000) || 0;
  return DAILY[((n * 3) % DAILY.length + DAILY.length) % DAILY.length];
}
var BOT_SKINS = [
  { cols: ['#ff6b6b', '#ffd0d0'], seq: [0, 0, 1] }, { cols: ['#ffa94d', '#7a3d00'], seq: [0, 0, 1] },
  { cols: ['#c084fc', '#f3e8ff'], seq: [0, 1] }, { cols: ['#4dabf7', '#0b3d6b'], seq: [0, 0, 0, 1] },
  { cols: ['#69db7c', '#fff3bf'], seq: [0, 1, 1] }, { cols: ['#f783ac', '#5c1a33'], seq: [0, 0, 1] },
  { cols: ['#ffe066', '#e8590c'], seq: [0, 1] }, { cols: ['#38d9a9', '#087f5b'], seq: [0, 0, 1, 1] },
  { cols: ['#e599f7', '#5f3dc4'], seq: [0, 1, 1] }, { cols: ['#adb5bd', '#343a40'], seq: [0, 0, 1] },
  { cols: ['#ff8787', '#ffd43b', '#69db7c'], seq: [0, 1, 2] }, { cols: ['#74c0fc', '#ffffff'], seq: [0, 0, 1] },
  { cols: ['#d9480f', '#ffd8a8'], seq: [0, 1] }, { cols: ['#9775fa', '#63e6be'], seq: [0, 0, 1, 1] },
  { cols: ['#a9e34b', '#2b8a3e'], seq: [0, 1, 1] }, { cols: ['#ffc9c9', '#c92a2a'], seq: [0, 0, 1] }
];
/* 먹이 색: 처음 쓰는 색이면 표에 넣고 번호를 돌려준다 */
var PALETTE = ['#ff6b6b', '#ffa94d', '#ffe066', '#a9e34b', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac', '#66d9e8', '#ffd8a8', '#e599f7', '#ffffff'];
var NAT_COLS = 12;
function colIdx(c) { var i = PALETTE.indexOf(c); if (i < 0) { if (PALETTE.length >= 250) return 11; PALETTE.push(c); i = PALETTE.length - 1; } return i; }

/* ── 이름: 직접 지은 우스운 별명 ── */
var NAMES = ['꿈틀대장', '국수가닥', '미역줄기', '라면사리', '꼬물이', '흙파는중', '밤새꿈틀', '배고픈국수', '느림보탈출', '길쭉이',
  '말랑젤리', '비오는날', '텃밭지킴이', '우동한사발', '냉면사리', '젤리빈', '꼬리잡기달인', '무지개국수', '월요병', '칼퇴요정',
  '부스터중독', '겁쟁이국수', '사냥꾼해삼', '방울토마토', '콩나물대가리', '당면공주', '떡볶이국물', '스파게티왕', '쫄면한그릇', '꿈틀이삼촌',
  '구불구불', '흙수저아님', '지렁이박사', '한입만', '야식요정', '먹방꿈틀', '줄넘기선수', '고무줄', '소면소년', '칼국수장인',
  '흙냄새좋아', '모퉁이매복', '꼬리조심', '빙글빙글', '숨바꼭질', '배부른척', '간식도둑', '멸치볶음', '김밥꼬다리', '소시지빵'];
var TYPES = ['forager', 'hunter', 'coward'];

function pushEv(G, ev) {
  G.ev.push(ev);
  if (!G.netEv) G.netEv = [];
  G.netEv.push(ev);
}

/* ── 게임 만들기 ── */
function newGame(opt) {
  opt = opt || {};
  var seed = (opt.seed === undefined ? 12345 : opt.seed) >>> 0;
  var G = {
    seed: seed, rng: rng(seed), tick: 0, worms: [], nextId: 1, player: null, input: { a: 0, boost: false },
    botBase: clamp(opt.bots === undefined ? 20 : opt.bots | 0, 0, 40), botTarget: 0, orbTarget: 1000, quality: 0,
    orbMul: opt.orbMul || 1, orbVal: opt.orbVal || 1, botTypes: opt.types || TYPES, botMass: opt.botMass || 1,
    limit: opt.limit || 0, done: false, startM: opt.mass || START_M,
    ox: new Float32Array(ORB_CAP), oy: new Float32Array(ORB_CAP), ov: new Float32Array(ORB_CAP), ol: new Float32Array(ORB_CAP),
    oc: new Uint8Array(ORB_CAP), ok: new Uint8Array(ORB_CAP), oa: new Uint8Array(ORB_CAP), ofree: new Int32Array(ORB_CAP), ofn: 0, nat: 0, orbs: 0,
    ogHead: new Int32Array(OGN * OGN), ogNext: new Int32Array(ORB_CAP),
    gHead: new Int32Array(GN * GN), gNext: new Int32Array(16384), gW: new Int32Array(16384), gX: new Float32Array(16384), gY: new Float32Array(16384), gR: new Float32Array(16384), gN: 0,
    byId: {}, ev: [], netEv: [], stats: { deaths: [], spawns: 0 }, lastSpawn: -999, usedNames: {},
    bananas: [], appleJellies: [], durians: []
  };
  for (var i = ORB_CAP - 1; i >= 0; i--) G.ofree[G.ofn++] = i;
  G.ogHead.fill(-1); G.gHead.fill(-1);
  setQuality(G, opt.quality || 0);
  /* 먹이를 먼저 깔고 */
  while (G.nat < G.orbTarget) spawnNatural(G);
  /* 컴퓨터 지렁이 */
  for (i = 0; i < G.botTarget; i++) spawnBot(G, true);
  if (opt.player) {
    var sk = opt.skin ? skinById(opt.skin) : SKINS[0];
    var p = safeSpot(G, 0.55);
    G.player = makeWorm(G, opt.name || '나', sk, null, G.startM, p.x, p.y, p.a);
    G.input.a = p.a;
  }
  buildGrid(G); buildOrbGrid(G);
  return G;
}
function setQuality(G, q) {
  G.quality = q = clamp(q | 0, 0, 3);
  G.orbTarget = Math.round([1000, 780, 560, 420][q] * (G.orbMul || 1));
  G.botTarget = Math.min(G.botBase, [40, 40, 15, 12][q]);
}

/* ── 먹이 ── */
function addOrb(G, x, y, v, c, life, kind) {
  if (!G.ofn) return -1;
  var i = G.ofree[--G.ofn];
  G.ox[i] = x; G.oy[i] = y; G.ov[i] = v; G.oc[i] = c; G.ol[i] = life; G.ok[i] = kind; G.oa[i] = 1;
  G.orbs++; if (kind === 0) G.nat++;
  return i;
}
function delOrb(G, i) {
  if (!G.oa[i]) return;
  G.oa[i] = 0; G.orbs--; if (G.ok[i] === 0) G.nat--;
  G.ofree[G.ofn++] = i;
}
function spawnNatural(G) {
  var R = G.rng, d = Math.sqrt(R()) * (ARENA - 40), t = R() * TAU, u = R();
  return addOrb(G, Math.cos(t) * d, Math.sin(t) * d, (u < 0.82 ? 1 : u < 0.96 ? 2 : 4) * (G.orbVal || 1), (R() * NAT_COLS) | 0, -1, 0);
}
function orbRadius(v) { return 3 + Math.sqrt(v) * 2.6; }

/* ── 지렁이 ── */
function makeWorm(G, name, skin, ai, m, x, y, a) {
  var w = { id: G.nextId++, name: name, skin: skin, col: colIdx(skin.cols[0]), ai: ai, m: m, maxM: m, x: x, y: y, a: a, ta: a, bIn: false, boosting: false,
    alive: true, kills: 0, born: G.tick, dropAcc: 0, r: 0, sp: 0, n: 0, len: 0,
    tx: null, ty: null, th: 0, tc: 0, tcap: 0, sx: null, sy: null, scap: 0, dieT: -1, cause: '',
    slowTimer: 0, bananas: 0, appleJellies: 0, jumpTimer: 0, landImmune: 0,
    durians: 0, fartConfuseTimer: 0, fartPoisonTimer: 0, fartLossRate: 0, fartDropAcc: 0 };
  shape(w);
  var need = Math.ceil(w.len / TD) + 4;
  w.tcap = pow2(need + 16); w.tx = getArr(w.tcap); w.ty = getArr(w.tcap);
  var ca = Math.cos(a), sa = Math.sin(a);
  /* 자취를 뒤쪽 일직선으로 미리 깔아 둔다(가장 오래된 점부터) */
  for (var j = 0; j < need; j++) { var k = need - j; w.tx[j] = x - ca * TD * k; w.ty[j] = y - sa * TD * k; }
  w.th = need - 1; w.tc = need;
  segs(w);
  G.worms.push(w); G.byId[w.id] = w;
  return w;
}
/* 질량이 바뀌면 굵기·간격·마디 수와 배열 크기를 맞춘다 */
function shape(w) {
  w.r = radius(w.m); w.sp = spacing(w.r); w.len = bodyLen(w.m); w.n = segCount(w.m);
  if (w.n + 2 > w.scap) {
    var cap = pow2(w.n + 8);
    putArr(w.sx); putArr(w.sy);
    w.sx = getArr(cap); w.sy = getArr(cap); w.scap = cap;
  }
  var need = Math.ceil(w.len / TD) + 4;
  if (w.tx && need + 4 > w.tcap) {
    var nc = pow2(need + 64), nx = getArr(nc), ny = getArr(nc), mask = w.tcap - 1;
    for (var j = 0; j < w.tc; j++) { var src = (w.th - (w.tc - 1) + j) & mask; nx[j] = w.tx[src]; ny[j] = w.ty[src]; }
    putArr(w.tx); putArr(w.ty);
    w.tx = nx; w.ty = ny; w.tcap = nc; w.th = w.tc - 1;
  }
}
function release(w) { putArr(w.tx); putArr(w.ty); putArr(w.sx); putArr(w.sy); w.tx = w.ty = w.sx = w.sy = null; w.tcap = w.scap = 0; }
/* 자취를 따라 마디 위치를 다시 잡는다 */
function segs(w) {
  var tx = w.tx, ty = w.ty, mask = w.tcap - 1, th = w.th, tc = w.tc, sx = w.sx, sy = w.sy, sp = w.sp, n = w.n;
  var lx = tx[th], ly = ty[th], hx = w.x, hy = w.y, d0 = Math.sqrt((hx - lx) * (hx - lx) + (hy - ly) * (hy - ly));
  sx[0] = hx; sy[0] = hy;
  var oldest = (th - (tc - 1)) & mask;
  for (var i = 1; i < n; i++) {
    var s = i * sp;
    if (s <= d0) { var f0 = d0 > 0 ? s / d0 : 0; sx[i] = hx + (lx - hx) * f0; sy[i] = hy + (ly - hy) * f0; continue; }
    var k = (s - d0) / TD, j = k | 0, f = k - j;
    if (j + 1 >= tc) { sx[i] = tx[oldest]; sy[i] = ty[oldest]; continue; }
    var a = (th - j) & mask, b = (th - j - 1) & mask;
    sx[i] = tx[a] + (tx[b] - tx[a]) * f; sy[i] = ty[a] + (ty[b] - ty[a]) * f;
  }
}
/* 시험·처음 자리: 머리를 (x,y)로 옮기고 자취를 뒤쪽 일직선으로 다시 깐다 */
function placeWorm(w, x, y, a) {
  var need = Math.min(w.tcap, Math.ceil(w.len / TD) + 4), ca = Math.cos(a), sa = Math.sin(a);
  for (var j = 0; j < need; j++) { var k = need - j; w.tx[j] = x - ca * TD * k; w.ty[j] = y - sa * TD * k; }
  w.th = need - 1; w.tc = need; w.x = x; w.y = y; w.a = w.ta = a;
  segs(w);
}
function moveWorm(w, dt) {
  if (w.fartConfuseTimer > 0) {
    w.fartConfuseTimer -= dt;
    if (w.fartConfuseTimer <= 0.001) w.fartConfuseTimer = 0;
    w.a = wrapA(w.a + 16.0 * dt);
    w.ta = w.a;
    return;
  }
  var diff = wrapA(w.ta - w.a), mt = turnRate(w.r) * dt * (w.boosting ? 0.85 : 1);
  w.a = wrapA(w.a + clamp(diff, -mt, mt));
  var v = w.boosting ? BOOST_V : BASE_V;
  if (w.slowTimer > 0) {
    w.slowTimer = Math.max(0, w.slowTimer - dt);
    v *= 0.5;
  }
  w.x += Math.cos(w.a) * v * dt; w.y += Math.sin(w.a) * v * dt;
  var mask = w.tcap - 1, lx = w.tx[w.th], ly = w.ty[w.th], dx = w.x - lx, dy = w.y - ly, d = Math.sqrt(dx * dx + dy * dy);
  while (d >= TD) {
    var k = TD / d; lx += dx * k; ly += dy * k;
    w.th = (w.th + 1) & mask; w.tx[w.th] = lx; w.ty[w.th] = ly; if (w.tc < w.tcap) w.tc++;
    dx = w.x - lx; dy = w.y - ly; d = Math.sqrt(dx * dx + dy * dy);
  }
}
function grow(w, dm) {
  w.m = Math.max(1, w.m + dm); if (w.m > w.maxM) w.maxM = w.m;
  var r0 = w.r, n0 = w.n;
  var n1 = segCount(w.m), r1 = radius(w.m);
  if (n1 !== n0 || Math.abs(r1 - r0) > 0.01) shape(w);
}

/* ── 공간 해시 (마디) ── */
function buildGrid(G) {
  var gh = G.gHead; gh.fill(-1);
  var n = 0, ws = G.worms;
  for (var k = 0; k < ws.length; k++) { var w = ws[k]; if (w.alive && (!w.jumpTimer || w.jumpTimer <= 0)) n += w.n; }
  if (n > G.gNext.length) { var c = pow2(n + 1024); G.gNext = new Int32Array(c); G.gW = new Int32Array(c); G.gX = new Float32Array(c); G.gY = new Float32Array(c); G.gR = new Float32Array(c); }
  var gn = G.gNext, gw = G.gW, gx = G.gX, gy = G.gY, gr = G.gR, idx = 0;
  for (k = 0; k < ws.length; k++) {
    w = ws[k]; if (!w.alive || (w.jumpTimer > 0)) continue;
    for (var i = 0; i < w.n; i++) {
      var x = w.sx[i], y = w.sy[i], cx = ((x + ARENA) / CELL) | 0, cy = ((y + ARENA) / CELL) | 0;
      if (cx < 0) cx = 0; else if (cx >= GN) cx = GN - 1;
      if (cy < 0) cy = 0; else if (cy >= GN) cy = GN - 1;
      var c2 = cy * GN + cx;
      gx[idx] = x; gy[idx] = y; gw[idx] = w.id; gr[idx] = w.r; gn[idx] = gh[c2]; gh[c2] = idx; idx++;
    }
  }
  G.gN = idx;
}
/* (x,y) 반지름 rad 안에 selfId 가 아닌 지렁이 마디가 있으면 그 마디 번호, 없으면 -1. 가장 가까운 것 */
function hitAt(G, x, y, rad, selfId, k1, k2) {
  var reach = rad + MAX_SEG_R, gh = G.gHead, gn = G.gNext, gw = G.gW, gx = G.gX, gy = G.gY, gr = G.gR;
  var x0 = ((x - reach + ARENA) / CELL) | 0, x1 = ((x + reach + ARENA) / CELL) | 0, y0 = ((y - reach + ARENA) / CELL) | 0, y1 = ((y + reach + ARENA) / CELL) | 0;
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= GN) x1 = GN - 1; if (y1 >= GN) y1 = GN - 1;
  var best = -1, bd = 1e18;
  if (k1 === undefined) { k1 = 1; k2 = 1; }
  for (var cy = y0; cy <= y1; cy++) for (var cx = x0; cx <= x1; cx++) {
    for (var s = gh[cy * GN + cx]; s >= 0; s = gn[s]) {
      if (gw[s] === selfId) continue;
      var dx = gx[s] - x, dy = gy[s] - y, rr = rad * k1 + gr[s] * k2, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 < bd) { bd = d2; best = s; }
    }
  }
  return best;
}
/* 무차별 대조용(시험): 모든 마디를 다 본다 */
function hitBrute(G, x, y, rad, selfId, k1, k2) {
  var best = -1, bd = 1e18;
  for (var s = 0; s < G.gN; s++) {
    if (G.gW[s] === selfId) continue;
    var dx = G.gX[s] - x, dy = G.gY[s] - y, rr = rad * k1 + G.gR[s] * k2, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 < bd) { bd = d2; best = s; }
  }
  return best;
}
var HEAD_K = 0.7, BODY_K = 0.85;   // 머리 판정은 조금 너그럽게(살짝 스친 정도는 산다)

/* ── 먹기 ── */
function buildOrbGrid(G) {
  var gh = G.ogHead, gn = G.ogNext; gh.fill(-1);
  for (var i = 0; i < ORB_CAP; i++) {
    if (!G.oa[i]) continue;
    var cx = ((G.ox[i] + ARENA) / OCELL) | 0, cy = ((G.oy[i] + ARENA) / OCELL) | 0;
    if (cx < 0) cx = 0; else if (cx >= OGN) cx = OGN - 1;
    if (cy < 0) cy = 0; else if (cy >= OGN) cy = OGN - 1;
    var c = cy * OGN + cx; gn[i] = gh[c]; gh[c] = i;
  }
}
function eat(G, w) {
  var S = w.r * 1.6 + 38, E = w.r + 5, x = w.x, y = w.y, gh = G.ogHead, gn = G.ogNext;
  var x0 = ((x - S + ARENA) / OCELL) | 0, x1 = ((x + S + ARENA) / OCELL) | 0, y0 = ((y - S + ARENA) / OCELL) | 0, y1 = ((y + S + ARENA) / OCELL) | 0;
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= OGN) x1 = OGN - 1; if (y1 >= OGN) y1 = OGN - 1;
  var got = 0;
  for (var cy = y0; cy <= y1; cy++) for (var cx = x0; cx <= x1; cx++) {
    for (var i = gh[cy * OGN + cx]; i >= 0; i = gn[i]) {
      if (!G.oa[i]) continue;
      var dx = x - G.ox[i], dy = y - G.oy[i], d2 = dx * dx + dy * dy, er = E + orbRadius(G.ov[i]) * 0.5;
      if (d2 < er * er) { got += G.ov[i]; delOrb(G, i); }
      else if (d2 < S * S) { G.ox[i] += dx * 0.24; G.oy[i] += dy * 0.24; }
    }
  }
  if (got > 0) { grow(w, got); if (w === G.player || w.isGuest) pushEv(G, { t: 'eat', v: got, id: w.id }); }
}

/* ── 죽음 ── */
function kill(G, w, killer, cause) {
  if (!w.alive) return;
  w.alive = false; w.dieT = G.tick; w.cause = cause;
  var total = w.m * DEATH_DROP, k = clamp(Math.round(w.m / 8), 4, Math.min(w.n * 2, 240)), v = total / k, R = G.rng;
  var cx = 0, cy = 0;
  for (var j = 0; j < k; j++) {
    var si = k > 1 ? Math.round(j * (w.n - 1) / (k - 1)) : 0, t = R() * TAU, d = R() * w.r * 0.9;
    var px = w.sx[si] + Math.cos(t) * d, py = w.sy[si] + Math.sin(t) * d;
    var dc = Math.sqrt(px * px + py * py); if (dc > ARENA - 12) { px *= (ARENA - 12) / dc; py *= (ARENA - 12) / dc; }
    var col = w.skin.rainbow ? (j % NAT_COLS) : colIdx(w.skin.cols[(w.skin.seq ? w.skin.seq[si % w.skin.seq.length] : 0)]);
    addOrb(G, px, py, v, col, 70 + R() * 30, 1);
    cx += px; cy += py;
  }
  cx /= k; cy /= k;
  if (killer) killer.kills++;
  G.stats.deaths.push({ id: w.id, type: w.ai ? w.ai.type : 'player', life: (G.tick - w.born) * STEP, m: w.maxM, cause: cause, by: killer ? killer.id : 0 });
  pushEv(G, { t: 'die', id: w.id, name: w.name, m: w.m, x: cx, y: cy, by: killer ? killer.id : 0, byName: killer ? killer.name : '', player: w === G.player, byPlayer: !!(killer && killer === G.player), cause: cause });
  /* 근처 컴퓨터 지렁이는 잔치 자리로 몰려간다 */
  if (w.m > 70) {
    for (var q = 0; q < G.worms.length; q++) {
      var o = G.worms[q]; if (!o.alive || !o.ai) continue;
      var dx = o.x - cx, dy = o.y - cy;
      if (dx * dx + dy * dy < 900 * 900 && R() < 0.7) { o.ai.fx = cx; o.ai.fy = cy; o.ai.fT = G.tick + 150; }
    }
  }
  release(w);
}

/* ── 안전한 자리 찾기 ── */
function safeSpot(G, frac) {
  var R = G.rng, best = null, bs = -1;
  for (var t = 0; t < 40; t++) {
    var d = Math.sqrt(R()) * ARENA * frac, an = R() * TAU, x = Math.cos(an) * d, y = Math.sin(an) * d;
    var score = 1e9;
    for (var q = 0; q < G.worms.length; q++) {
      var o = G.worms[q]; if (!o.alive) continue;
      for (var i = 0; i < o.n; i += 3) { var dx = o.sx[i] - x, dy = o.sy[i] - y, dd = dx * dx + dy * dy; if (dd < score) score = dd; }
    }
    if (score > bs) { bs = score; best = { x: x, y: y, a: Math.atan2(-y, -x) + (R() - 0.5) * 1.6 }; }
    if (score > 600 * 600) break;
  }
  return best;
}
function pickName(G) {
  var R = G.rng;
  for (var t = 0; t < 30; t++) { var n = NAMES[(R() * NAMES.length) | 0]; if (!G.usedNames[n]) return n; }
  return NAMES[(R() * NAMES.length) | 0] + ((R() * 90 + 10) | 0);
}
function spawnBot(G, initial) {
  var R = G.rng, u = R(), m;
  if (initial) m = u < 0.6 ? 20 + R() * 120 : u < 0.92 ? 150 + R() * 550 : 800 + R() * 1400;
  else m = u < 0.85 ? 20 + R() * 60 : 100 + R() * 300;
  if (initial && G.botMass > 1) m *= G.botMass;
  var TY = G.botTypes || TYPES, type = TY.length === 3 ? TYPES[(R() * 3) | 0] : TY[(R() * TY.length) | 0];
  var ai = { type: type, skill: type === 'coward' ? 1.05 + R() * 0.25 : 0.8 + R() * 0.4, aggr: 0.3 + R() * 0.7, nerve: 0.8 + R() * 0.5, cw: R() < 0.5,
    wa: R() * TAU, tgt: -1, fx: 0, fy: 0, fT: -1, mode: '', prey: 0 };
  var s = safeSpot(G, 0.88), name = pickName(G);
  var w = makeWorm(G, name, BOT_SKINS[(R() * BOT_SKINS.length) | 0], ai, m, s.x, s.y, s.a);
  G.usedNames[name] = 1; G.stats.spawns++; G.lastSpawn = G.tick;
  return w;
}

/* ── 컴퓨터 지렁이 생각 ── */
function blockedAt(G, w, x, y, rad) {
  var dc = Math.sqrt(x * x + y * y);
  if (dc > ARENA - rad - 24) return true;
  if (hitAt(G, x, y, rad + 8, w.id, 1, 1) >= 0) return true;
  /* 다른 머리가 곧 올 자리 */
  var ws = G.worms;
  for (var q = 0; q < ws.length; q++) {
    var o = ws[q]; if (o === w || !o.alive) continue;
    var px = o.x + Math.cos(o.a) * (o.boosting ? 70 : 38), py = o.y + Math.sin(o.a) * (o.boosting ? 70 : 38), dx = px - x, dy = py - y, rr = rad + o.r + 12;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}
function clearDist(G, w, ang, look) {
  var ca = Math.cos(ang), sa = Math.sin(ang), rad = w.r, ts = [w.r * 1.3 + 6, look * 0.35, look * 0.68, look], prev = 0;
  for (var k = 0; k < 4; k++) {
    var t = ts[k];
    if (blockedAt(G, w, w.x + ca * t, w.y + sa * t, rad)) return prev;
    prev = t;
  }
  return look;
}
var OFFS = [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.35, -1.35, 1.9, -1.9, 2.6, -2.6, Math.PI];
function avoid(G, w, da) {
  var look = ((w.boosting ? 250 : 165) + w.r * 3) * w.ai.skill, bestA = da, bestC = -1;
  /* 지금 가는 방향과 가까운 쪽부터 — 몸을 돌리는 데 시간이 걸리므로 */
  for (var k = 0; k < OFFS.length; k++) {
    var ang = da + OFFS[k], c = clearDist(G, w, ang, look);
    if (c >= look) return { a: ang, danger: k > 2 };
    if (c > bestC + 1) { bestC = c; bestA = ang; }
  }
  return { a: bestA, danger: true };
}
function forage(G, w, B, rad) {
  var x = w.x, y = w.y, gh = G.ogHead, gn = G.ogNext, best = -1, bs = 0;
  var x0 = ((x - rad + ARENA) / OCELL) | 0, x1 = ((x + rad + ARENA) / OCELL) | 0, y0 = ((y - rad + ARENA) / OCELL) | 0, y1 = ((y + rad + ARENA) / OCELL) | 0;
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= OGN) x1 = OGN - 1; if (y1 >= OGN) y1 = OGN - 1;
  var ca = Math.cos(w.a), sa = Math.sin(w.a);
  for (var cy = y0; cy <= y1; cy++) for (var cx = x0; cx <= x1; cx++) {
    for (var i = gh[cy * OGN + cx]; i >= 0; i = gn[i]) {
      if (!G.oa[i]) continue;
      var dx = G.ox[i] - x, dy = G.oy[i] - y, d = Math.sqrt(dx * dx + dy * dy) + 1;
      if (d > rad) continue;
      var front = (dx * ca + dy * sa) / d, sc = G.ov[i] / (d + 50) * (1.25 + front);
      if (sc > bs) { bs = sc; best = i; }
    }
  }
  return best;
}
function think(G, w) {
  var B = w.ai, R = G.rng, hx = w.x, hy = w.y, da = w.a, boost = false, ws = G.worms;
  var threat = null, td = 1e9, prey = null, pd = 1e9;
  for (var q = 0; q < ws.length; q++) {
    var o = ws[q]; if (o === w || !o.alive) continue;
    var dx = o.x - hx, dy = o.y - hy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 750) continue;
    if ((B.type === 'coward' && o.m > w.m * 0.8) || (o.m > w.m * 3 && d < 240)) { if (d < td) { td = d; threat = o; } }
    if (B.type === 'hunter' && o.m < w.m * 1.15 && d < pd) { pd = d; prey = o; }
  }
  B.mode = '';
  if (threat && td < (B.type === 'coward' ? 470 * B.nerve : 200)) {
    da = Math.atan2(hy - threat.y, hx - threat.x);
    boost = td < 230 && w.m > MIN_BOOST + 15 && B.type === 'coward';
    B.mode = 'flee';
  } else if (B.type === 'hunter' && prey && pd < 650 && w.m > 60) {
    var L = w.len;
    B.prey = prey.id;
    if (L > 700 && pd < L * 0.24 && prey.m < w.m * 0.6) {
      /* 몸으로 빙 둘러 가두기: 먹잇감 둘레를 돌며 점점 조인다 */
      var ang = Math.atan2(hy - prey.y, hx - prey.x), dir = B.cw ? 1 : -1;
      var want = Math.max(prey.r * 5 + w.r * 3, L / TAU * 0.75), err = clamp((pd - want) / want, -0.7, 0.7);
      da = ang + dir * (Math.PI / 2 + err * 0.9);
      B.mode = 'circle';
    } else {
      /* 앞질러 가로막기 */
      var lead = Math.min(pd * 0.7, 260) + 40;
      var px = prey.x + Math.cos(prey.a) * lead, py = prey.y + Math.sin(prey.a) * lead;
      da = Math.atan2(py - hy, px - hx);
      boost = pd < 380 && w.m > MIN_BOOST + 40 && Math.abs(wrapA(da - w.a)) < 0.6 && R() < B.aggr;
      B.mode = 'chase';
    }
  } else if (B.fT > G.tick) {
    var fx = B.fx - hx, fy = B.fy - hy;
    if (fx * fx + fy * fy < 70 * 70) B.fT = -1;
    da = Math.atan2(fy, fx);
    boost = w.m > 120 && B.type !== 'coward' && fx * fx + fy * fy > 250 * 250 && R() < B.aggr * 0.5;
    B.mode = 'feast';
  } else {
    var oi = forage(G, w, B, B.type === 'coward' ? 300 : 380);
    if (oi >= 0) {
      da = Math.atan2(G.oy[oi] - hy, G.ox[oi] - hx);
      if (B.type === 'forager' && G.ov[oi] >= 3 && w.m > 150 && R() < 0.15 * B.aggr) boost = true;
      B.mode = 'food';
    } else {
      B.wa = wrapA(B.wa + (R() - 0.5) * 0.5);
      da = B.wa; B.mode = 'wander';
    }
  }
  /* 가장자리에서 멀어지기 */
  var dc = Math.sqrt(hx * hx + hy * hy);
  if (dc > ARENA * 0.78) {
    var toC = Math.atan2(-hy, -hx), k = clamp((dc - ARENA * 0.78) / (ARENA * 0.15), 0, 1);
    da = da + wrapA(toC - da) * k;
    if (B.mode === 'wander') B.wa = toC;
  }
  var res = avoid(G, w, da);
  w.ta = wrapA(res.a);
  /* 부딪힐 것 같으면 (겁쟁이·실력 좋은 녀석은) 부스트로 빠져나가기도 한다 */
  if (res.danger && B.type === 'coward' && w.m > MIN_BOOST + 20 && R() < 0.2) boost = true;
  w.bIn = boost && w.m > MIN_BOOST + 5;
}

/* ── 바나나 아이템 (15초마다 스폰, 필드 최대 3개 유지, 플레이어 최대 3개 소지, F키로 5초간 800px 내 지렁이 50% 감속) ── */
function spawnBanana(G) {
  if (!G.bananas) G.bananas = [];
  var R = G.rng, d = Math.sqrt(R()) * (ARENA * 0.82), t = R() * TAU;
  var b = { id: G.nextId++, x: Math.cos(t) * d, y: Math.sin(t) * d, born: G.tick, r: 24 };
  G.bananas.push(b);
  if (G.bananas.length > 3) G.bananas.shift();
  pushEv(G, { t: 'banana_spawn', x: b.x, y: b.y });
  return b;
}

function useBanana(G, worm) {
  var p = worm || G.player;
  if (!p || !p.alive || !p.bananas) return false;
  p.bananas--;
  var affected = 0;
  var ws = G.worms;
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i];
    if (w === p || !w.alive) continue;
    var dx = w.x - p.x, dy = w.y - p.y;
    if (dx * dx + dy * dy <= 800 * 800) {
      w.slowTimer = 5.0;
      affected++;
    }
  }
  pushEv(G, { t: 'banana_use', x: p.x, y: p.y, r: 800, affected: affected });
  return true;
}

/* ── 사과젤리 아이템 (30초마다 스폰, 필드 최대 3개 유지, 플레이어 최대 3개 소지, Space키로 1초간 점프 무적) ── */
function spawnAppleJelly(G) {
  if (!G.appleJellies) G.appleJellies = [];
  var R = G.rng, d = Math.sqrt(R()) * (ARENA * 0.82), t = R() * TAU;
  var j = { id: G.nextId++, x: Math.cos(t) * d, y: Math.sin(t) * d, born: G.tick, r: 22 };
  G.appleJellies.push(j);
  if (G.appleJellies.length > 3) G.appleJellies.shift();
  pushEv(G, { t: 'jelly_spawn', x: j.x, y: j.y });
  return j;
}

function useAppleJelly(G, worm) {
  var p = worm || G.player;
  if (!p || !p.alive || !p.appleJellies || p.jumpTimer > 0) return false;
  p.appleJellies--;
  p.jumpTimer = 1.0;
  p.landImmune = 0;
  pushEv(G, { t: 'jelly_jump', x: p.x, y: p.y });
  return true;
}

/* ── 두리안 아이템 (30초마다 스폰, 필드 최대 3개 유지, 플레이어 최대 3개 소지, C키로 꼬리에서 500px 방귀 발사) ── */
function spawnDurian(G) {
  if (!G.durians) G.durians = [];
  var R = G.rng, d = Math.sqrt(R()) * (ARENA * 0.82), t = R() * TAU;
  var dr = { id: G.nextId++, x: Math.cos(t) * d, y: Math.sin(t) * d, born: G.tick, r: 24 };
  G.durians.push(dr);
  if (G.durians.length > 3) G.durians.shift();
  pushEv(G, { t: 'durian_spawn', x: dr.x, y: dr.y });
  return dr;
}

function useDurian(G, worm) {
  var p = worm || G.player;
  if (!p || !p.alive || !p.durians) return false;
  p.durians--;

  var ti = Math.max(0, p.n - 1);
  var tx = (p.sx && p.sx[ti] !== undefined) ? p.sx[ti] : p.x;
  var ty = (p.sy && p.sy[ti] !== undefined) ? p.sy[ti] : p.y;
  var tailA = p.a + Math.PI;

  var affected = 0;
  var ws = G.worms;
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i];
    if (w === p || !w.alive) continue;
    var dx = w.x - tx, dy = w.y - ty;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 500) {
      var angToTarget = Math.atan2(dy, dx);
      var angDiff = Math.abs(wrapA(angToTarget - tailA));
      if (dist <= 200 || angDiff <= (Math.PI * 0.65)) {
        w.fartConfuseTimer = 0.5;
        w.fartPoisonTimer = 10.0;
        w.fartLossRate = (w.m * 0.30) / 10.0;
        w.fartDropAcc = 0;
        affected++;
      }
    }
  }
  pushEv(G, { t: 'durian_fart', x: tx, y: ty, a: tailA, r: 500, affected: affected });
  return true;
}

/* ── 한 스텝 ── */
function step(G) {
  var dt = STEP, ws = G.worms, R = G.rng, i, w;
  G.tick++;
  if (G.limit && G.tick * STEP >= G.limit) G.done = true;
  if (G.ev.length > 400) G.ev.splice(0, 200);
  /* 1) 생각·입력 */
  for (i = 0; i < ws.length; i++) {
    w = ws[i]; if (!w.alive) continue;
    if (w.jumpTimer > 0) {
      w.jumpTimer -= dt;
      if (w.jumpTimer <= 0) {
        w.jumpTimer = 0;
        w.landImmune = 0.3;
        pushEv(G, { t: 'jelly_land', x: w.x, y: w.y, id: w.id });
      }
    } else if (w.landImmune > 0) {
      w.landImmune = Math.max(0, w.landImmune - dt);
    }
    /* 두리안 방귀 중독 (10초간 몸 30% 감소 및 똥 먹이 배출) */
    if (w.fartPoisonTimer > 0) {
      w.fartPoisonTimer -= dt;
      if (w.fartPoisonTimer <= 0.001) w.fartPoisonTimer = 0;
      var loss = w.fartLossRate * dt;
      if (loss > 0 && w.m > 10) {
        var actualLoss = Math.min(loss, w.m - 5);
        w.m -= actualLoss;
        w.fartDropAcc = (w.fartDropAcc || 0) + actualLoss;
        if (w.fartDropAcc >= 1.2) {
          var fti = Math.max(0, w.n - 1);
          var orx = (w.sx && w.sx[fti] !== undefined) ? w.sx[fti] : w.x;
          var ory = (w.sy && w.sy[fti] !== undefined) ? w.sy[fti] : w.y;
          addOrb(G, orx + (R() - 0.5) * w.r * 0.8, ory + (R() - 0.5) * w.r * 0.8, w.fartDropAcc, 3, 40 + R() * 20, 2);
          w.fartDropAcc = 0;
        }
        grow(w, 0);
      }
    }
    if (w.ai) { if ((G.tick + w.id) % 3 === 0) think(G, w); }
    else if (w === G.player) { w.ta = G.input.a; w.bIn = !!G.input.boost; }
  }
  /* 2) 움직이기 + 부스트 */
  for (i = 0; i < ws.length; i++) {
    w = ws[i]; if (!w.alive) continue;
    w.boosting = w.bIn && w.m >= MIN_BOOST;
    moveWorm(w, dt);
    if (w.boosting) {
      var c = boostCost(w.m) * dt;
      w.m -= c; w.dropAcc += c * BOOST_DROP;
      if (w.dropAcc >= 1.2) {
        var ti = w.n - 1, t = R() * TAU;
        addOrb(G, w.sx[ti] + Math.cos(t) * w.r * 0.5, w.sy[ti] + Math.sin(t) * w.r * 0.5, w.dropAcc, w.skin.rainbow ? (G.tick % NAT_COLS) : w.col, 35 + R() * 15, 2);
        w.dropAcc = 0;
      }
      grow(w, 0);
    }
    segs(w);
  }
  /* 3) 먹이 */
  buildOrbGrid(G);
  for (i = 0; i < ws.length; i++) {
    w = ws[i];
    if (w.alive && (!w.jumpTimer || w.jumpTimer <= 0)) eat(G, w);
  }
  /* 4) 충돌 — 모두 검사한 다음 한꺼번에 죽인다(순서와 상관없이 같은 결과) */
  buildGrid(G);
  var dead = [];
  for (i = 0; i < ws.length; i++) {
    w = ws[i]; if (!w.alive) continue;
    var dc = Math.sqrt(w.x * w.x + w.y * w.y);
    if (dc + w.r * 0.5 > ARENA) { dead.push([w, null, 'wall']); continue; }
    if (w.jumpTimer > 0 || w.landImmune > 0) continue;
    var s = hitAt(G, w.x, w.y, w.r, w.id, HEAD_K, BODY_K);
    if (s >= 0) dead.push([w, G.byId[G.gW[s]], 'body']);
  }
  for (i = 0; i < dead.length; i++) kill(G, dead[i][0], dead[i][1], dead[i][2]);
  if (dead.length) {
    G.worms = ws = ws.filter(function (x) { return x.alive; });
    for (i = 0; i < dead.length; i++) { delete G.byId[dead[i][0].id]; G.usedNames[dead[i][0].name] = 0; }
    buildGrid(G);
  }
  /* 5) 먹이 수명·새 먹이 */
  if (G.tick % 30 === 0) {
    for (i = 0; i < ORB_CAP; i++) if (G.oa[i] && G.ol[i] > 0) { G.ol[i] -= 0.5; if (G.ol[i] <= 0) delOrb(G, i); }
  }
  for (i = 0; i < 6 && G.nat < G.orbTarget; i++) spawnNatural(G);
  if (G.nat > G.orbTarget + 10) trimOrbs(G, 8);
  /* 5-2) 바나나 스폰 (15초 = 900틱 마다 스폰) */
  if (G.tick % 900 === 0) {
    spawnBanana(G);
  }
  /* 플레이어 바나나 획득 검사 */
  /* 5-2) 바나나 스폰 (15초 = 900틱 마다 스폰) */
  if (G.tick % 900 === 0) {
    spawnBanana(G);
  }
  if (G.bananas && G.bananas.length) {
    for (var wi = 0; wi < ws.length; wi++) {
      var pl = ws[wi]; if (!pl.alive) continue;
      for (i = G.bananas.length - 1; i >= 0; i--) {
        var bn = G.bananas[i];
        var bdx = pl.x - bn.x, bdy = pl.y - bn.y;
        if (bdx * bdx + bdy * bdy < (pl.r + bn.r) * (pl.r + bn.r)) {
          G.bananas.splice(i, 1);
          if (pl.bananas < 3) pl.bananas++;
          pushEv(G, { t: 'banana_pickup', x: pl.x, y: pl.y, count: pl.bananas, id: pl.id });
        }
      }
    }
  }
  /* 5-3) 사과젤리 스폰 (30초 = 1800틱 마다 스폰) */
  if (G.tick % 1800 === 0) {
    spawnAppleJelly(G);
  }
  if (G.appleJellies && G.appleJellies.length) {
    for (var wi = 0; wi < ws.length; wi++) {
      var pl = ws[wi]; if (!pl.alive || (pl.jumpTimer && pl.jumpTimer > 0)) continue;
      for (i = G.appleJellies.length - 1; i >= 0; i--) {
        var aj = G.appleJellies[i];
        var adx = pl.x - aj.x, ady = pl.y - aj.y;
        if (adx * adx + ady * ady < (pl.r + aj.r) * (pl.r + aj.r)) {
          G.appleJellies.splice(i, 1);
          if (pl.appleJellies < 3) pl.appleJellies++;
          pushEv(G, { t: 'jelly_pickup', x: pl.x, y: pl.y, count: pl.appleJellies, id: pl.id });
        }
      }
    }
  }
  /* 5-4) 두리안 스폰 (30초 = 1800틱 마다 스폰) */
  if (G.tick % 1800 === 0) {
    spawnDurian(G);
  }
  if (G.durians && G.durians.length) {
    for (var wi = 0; wi < ws.length; wi++) {
      var pl = ws[wi]; if (!pl.alive || (pl.jumpTimer && pl.jumpTimer > 0)) continue;
      for (i = G.durians.length - 1; i >= 0; i--) {
        var dr = G.durians[i];
        var ddx = pl.x - dr.x, ddy = pl.y - dr.y;
        if (ddx * ddx + ddy * ddy < (pl.r + dr.r) * (pl.r + dr.r)) {
          G.durians.splice(i, 1);
          if (pl.durians < 3) pl.durians++;
          pushEv(G, { t: 'durian_pickup', x: pl.x, y: pl.y, count: pl.durians, id: pl.id });
        }
      }
    }
  }
  /* 6) 컴퓨터 지렁이 채우기 / 줄이기 */
  var bots = 0; for (i = 0; i < ws.length; i++) if (ws[i].ai) bots++;
  if (bots < G.botTarget && G.tick - G.lastSpawn > 40) spawnBot(G, false);
  else if (bots > G.botTarget && G.tick % 20 === 0) despawnFar(G);
}
/* 화질을 낮춰 먹이 목표가 줄면: 플레이어 화면 밖의 자연 먹이를 조금씩 치운다 */
function trimOrbs(G, k) {
  var p = G.player, cut = 0;
  for (var t = 0; t < 400 && cut < k; t++) {
    var i = G.trimAt = ((G.trimAt | 0) + 1) % ORB_CAP;
    if (!G.oa[i] || G.ok[i] !== 0) continue;
    if (p && p.alive) { var dx = G.ox[i] - p.x, dy = G.oy[i] - p.y; if (dx * dx + dy * dy < 900 * 900) continue; }
    delOrb(G, i); cut++;
  }
}
/* 화질을 낮출 때: 내 화면에서 먼 컴퓨터 지렁이를 조용히 빼낸다(먹이 없이) */
function despawnFar(G) {
  var p = G.player, best = null, bd = -1;
  for (var i = 0; i < G.worms.length; i++) {
    var w = G.worms[i]; if (!w.ai) continue;
    var d = p && p.alive ? (w.x - p.x) * (w.x - p.x) + (w.y - p.y) * (w.y - p.y) : i;
    if (d > bd) { bd = d; best = w; }
  }
  if (!best || (p && p.alive && bd < 1200 * 1200)) return;
  best.alive = false; release(best);
  G.worms = G.worms.filter(function (x) { return x.alive; });
  delete G.byId[best.id]; G.usedNames[best.name] = 0;
  buildGrid(G);
}
/* 3분 타임어택: 내 지렁이를 안전한 곳에 새로 태어나게 한다 */
function respawnPlayer(G, name, skin) {
  var p = safeSpot(G, 0.6), w = makeWorm(G, name || '나', skin || SKINS[0], null, G.startM, p.x, p.y, p.a);
  G.player = w; G.input.a = p.a; G.input.boost = false;
  buildGrid(G);
  return w;
}
/* 온라인 멀티: 원격 접속 플레이어 생성 */
function spawnGuestWorm(G, name, skin) {
  var sk = skin ? (typeof skin === 'string' ? skinById(skin) : skin) : SKINS[0];
  var p = safeSpot(G, 0.55);
  var w = makeWorm(G, name || '참가자', sk, null, G.startM, p.x, p.y, p.a);
  w.isGuest = true;
  w.ta = p.a;
  w.bIn = false;
  buildGrid(G);
  return w;
}
function ranking(G) {
  return G.worms.filter(function (w) { return w.alive; }).sort(function (a, b) { return b.m - a.m || a.id - b.id; });
}
function hash(G) {
  var h = G.tick * 1.0, ws = G.worms;
  for (var i = 0; i < ws.length; i++) { var w = ws[i]; h += (w.x * 1.3 + w.y * 0.7 + w.m * 3.1 + w.id) * (i + 1); }
  h += G.orbs * 17 + G.stats.deaths.length * 101;
  return Math.round(h * 1000) / 1000;
}

/* ── 멀티플레이어 스냅샷 직렬화 / 역직렬화 ── */
function serializeSnapshot(G) {
  var ws = [];
  for (var i = 0; i < G.worms.length; i++) {
    var w = G.worms[i];
    if (!w.alive) continue;
    ws.push({
      id: w.id, name: w.name, skin: (w.skin && w.skin.id) || 'grass',
      x: Math.round(w.x), y: Math.round(w.y), a: +w.a.toFixed(3),
      m: Math.round(w.m), r: +w.r.toFixed(1),
      boosting: !!w.boosting,
      jumpTimer: +(w.jumpTimer || 0).toFixed(2),
      landImmune: +(w.landImmune || 0).toFixed(2),
      slowTimer: +(w.slowTimer || 0).toFixed(2),
      fartConfuseTimer: +(w.fartConfuseTimer || 0).toFixed(2),
      fartPoisonTimer: +(w.fartPoisonTimer || 0).toFixed(2),
      bananas: w.bananas || 0,
      appleJellies: w.appleJellies || 0,
      durians: w.durians || 0,
      n: w.n,
      sx: Array.from(w.sx.subarray(0, w.n)).map(function (v) { return Math.round(v); }),
      sy: Array.from(w.sy.subarray(0, w.n)).map(function (v) { return Math.round(v); })
    });
  }

  var orbs = [];
  for (var j = 0; j < G.ox.length; j++) {
    if (G.oa[j]) {
      orbs.push(Math.round(G.ox[j]), Math.round(G.oy[j]), G.ov[j], G.oc[j], G.ok[j]);
    }
  }

  var evs = G.netEv ? G.netEv.slice() : [];
  G.netEv = [];

  return {
    tick: G.tick,
    worms: ws,
    bananas: G.bananas || [],
    appleJellies: G.appleJellies || [],
    durians: G.durians || [],
    orbs: orbs,
    ev: evs
  };
}

function applySnapshot(G, s) {
  if (!G || !s) return;
  G.tick = s.tick;
  G.bananas = s.bananas || [];
  G.appleJellies = s.appleJellies || [];
  G.durians = s.durians || [];
  if (s.ev && s.ev.length) {
    G.ev = G.ev.concat(s.ev);
  }

  // 동기화: 먹이 구슬
  var orbs = s.orbs || [];
  var oCount = (orbs.length / 5) | 0;
  G.oa.fill(0);
  G.orbs = oCount;
  for (var k = 0; k < oCount; k++) {
    var base = k * 5;
    G.ox[k] = orbs[base];
    G.oy[k] = orbs[base + 1];
    G.ov[k] = orbs[base + 2];
    G.oc[k] = orbs[base + 3];
    G.ok[k] = orbs[base + 4];
    G.oa[k] = 1;
  }

  // 동기화: 지렁이
  var currentMap = {};
  for (var i = 0; i < G.worms.length; i++) currentMap[G.worms[i].id] = G.worms[i];

  var newWorms = [];
  for (var j = 0; j < s.worms.length; j++) {
    var sw = s.worms[j];
    var w = currentMap[sw.id];
    if (!w) {
      w = makeWorm(G, sw.name, skinById(sw.skin) || SKINS[0], null, sw.m, sw.x, sw.y, sw.a);
      w.id = sw.id;
    }
    w.x = sw.x; w.y = sw.y; w.a = sw.a; w.ta = sw.a;
    w.m = sw.m; w.r = sw.r; w.boosting = sw.boosting;
    w.jumpTimer = sw.jumpTimer; w.landImmune = sw.landImmune;
    w.slowTimer = sw.slowTimer;
    w.fartConfuseTimer = sw.fartConfuseTimer;
    w.fartPoisonTimer = sw.fartPoisonTimer;
    w.bananas = sw.bananas; w.appleJellies = sw.appleJellies; w.durians = sw.durians;
    w.n = sw.n;
    if (!w.sx || sw.n + 2 > (w.scap || 0)) shape(w);
    if (sw.sx && sw.sy) {
      for (var idx = 0; idx < sw.n; idx++) {
        w.sx[idx] = sw.sx[idx];
        w.sy[idx] = sw.sy[idx];
      }
    }
    w.alive = true;
    newWorms.push(w);
  }
  G.worms = newWorms;
  G.byId = {};
  for (var q = 0; q < G.worms.length; q++) G.byId[G.worms[q].id] = G.worms[q];
}

return {
  STEP: STEP, ARENA: ARENA, CELL: CELL, TD: TD, BASE_V: BASE_V, BOOST_V: BOOST_V, MIN_BOOST: MIN_BOOST, START_M: START_M, BOOST_DROP: BOOST_DROP, DEATH_DROP: DEATH_DROP,
  HEAD_K: HEAD_K, BODY_K: BODY_K, ORB_CAP: ORB_CAP, SKINS: SKINS, BOT_SKINS: BOT_SKINS, PALETTE: PALETTE, NAMES: NAMES, TYPES: TYPES,
  clamp: clamp, wrapA: wrapA, rng: rng, radius: radius, bodyLen: bodyLen, segCount: segCount, turnRate: turnRate, boostCost: boostCost, orbRadius: orbRadius,
  MODES: MODES, DAILY: DAILY, dailySeed: dailySeed, dailyRule: dailyRule, respawnPlayer: respawnPlayer, spawnGuestWorm: spawnGuestWorm, unlockedRec: unlockedRec,
  skinById: skinById, unlocked: unlocked, newGame: newGame, setQuality: setQuality, step: step, makeWorm: makeWorm, grow: grow, kill: kill, addOrb: addOrb, delOrb: delOrb,
  spawnBanana: spawnBanana, useBanana: useBanana,
  spawnAppleJelly: spawnAppleJelly, useAppleJelly: useAppleJelly,
  spawnDurian: spawnDurian, useDurian: useDurian,
  serializeSnapshot: serializeSnapshot, applySnapshot: applySnapshot,
  buildGrid: buildGrid, buildOrbGrid: buildOrbGrid, hitAt: hitAt, hitBrute: hitBrute, segs: segs, placeWorm: placeWorm, ranking: ranking, hash: hash, poolStats: poolStats, think: think, safeSpot: safeSpot
};
});
