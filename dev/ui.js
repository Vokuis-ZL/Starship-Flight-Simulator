/* ============================================================
   STARSHIP FLIGHT 14 — UI 模块 (dev/ui.js)
   全局对象 UI：UI.init(cb) / UI.update(state) / UI.showEnd(state)
   普通脚本，无 import/export；自行创建全部 DOM（canvas 除外）
   ============================================================ */
(function () {
'use strict';

var SVGNS = 'http://www.w3.org/2000/svg';

/* ---------------- 模块内部状态 ---------------- */
var cb = null;            // 回调 {onStart,onCmd,onInput,onRestart,onMenu}
var root = null;          // #ui-root
var $ = {};               // 预建 DOM 引用缓存
var state = null;         // 最近一次 PHYS.state

var menuVisible = true, endVisible = false, tutVisible = false, briefVisible = false;
var pendingCfg = null;                          // 教学结束后再启动的配置
var menuCfg = { mode: 'auto', timeMode: 'compressed', recovery: 0 };
var pendingParams = (typeof MISSION14 !== 'undefined') ? MISSION14.defaultParams()
  : { boosterEngines: 33, shipEngines: 6, thrustScale: 1.0, fuelScale: 1.0, sepAlt: 62, recovery: 0 };
var paramModeSel = 'script';

var drawerOpen = false, drawerPinned = false, drawerTimer = 0;

var eventCount = 0;       // 已消费的 state.events 条数
var toastCount = 0;       // 已消费的 state.toasts 条数
var lastLit = null;       // 引擎点阵上次点亮状态
var lastCkSig = '';       // 清单签名（避免每帧重建）
var lastGuide = '';
var lastInput = { pitch: 0, yaw: 0, roll: 0 };  // 上次发送的持续输入
var keys = {};            // 按住的键 e.code -> bool
var lastFrame = performance.now();
var drag = { thr: 0, pitch: 0 };                // 滑条最近被用户拖动的时间戳
var gaugeSpeed = null, gaugeAlt = null;
var engDots = [], fuelArc = null, fuelTxt = null, fuelTxtVal = '';
var audio = null, muted = false;

/* ---------------- 小工具 ---------------- */
function el(tag, cls, parent, text) {
  var d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  if (parent) parent.appendChild(d);
  return d;
}
function sv(tag, attrs, parent) {
  var n = document.createElementNS(SVGNS, tag);
  for (var k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function setText(n, s) { if (n && n.__t !== s) { n.__t = s; n.textContent = s; } }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtClock(t) {           // 任务时钟：T+MM:SS（超 1 小时含时位）
  var s = Math.abs(t || 0);
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  return (h > 0 ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(ss);
}
function actVeh() {
  return (state && state.vehicles && state.vehicles[state.active]) || null;
}

/* ============================================================
   148px 圆形刻度仪表（SPEED / ALTITUDE）
   细刻度每 6°，主刻度每 30° 加长；刻度环随 val/max·360 旋转
   ============================================================ */
function buildGauge(label, unit, max, fmt) {
  var wrap = el('div', 'gauge');
  var svg = sv('svg', { viewBox: '0 0 148 148', width: 148, height: 148 }, wrap);
  var ring = sv('g', {}, svg);
  for (var a = 0; a < 360; a += 6) {
    var major = (a % 30 === 0);
    var rad = (a - 90) * Math.PI / 180;
    var r1 = major ? 57 : 62, r2 = 68;
    sv('line', {
      x1: 74 + Math.cos(rad) * r1, y1: 74 + Math.sin(rad) * r1,
      x2: 74 + Math.cos(rad) * r2, y2: 74 + Math.sin(rad) * r2,
      stroke: major ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.32)',
      'stroke-width': major ? 1.6 : 1
    }, ring);
  }
  sv('path', { d: 'M74 1 L77.5 7 L70.5 7 Z', fill: '#fff' }, svg); // 顶部固定指示
  var val = sv('text', { x: 74, y: 82, 'text-anchor': 'middle', fill: '#fff',
    'font-size': 26, 'font-weight': 600, 'letter-spacing': 1 }, svg);
  val.textContent = fmt(0);
  var unitT = sv('text', { x: 74, y: 97, 'text-anchor': 'middle',
    fill: 'rgba(255,255,255,.6)', 'font-size': 8.5, 'letter-spacing': 2 }, svg);
  unitT.textContent = unit;
  var lab = sv('text', { x: 74, y: 131, 'text-anchor': 'middle',
    fill: 'rgba(255,255,255,.85)', 'font-size': 10.5, 'letter-spacing': 3 }, svg);
  lab.textContent = label;
  return {
    wrap: wrap,
    set: function (v) {
      var deg = (clamp(v, 0, max) / max * 360) % 360;
      ring.setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 74 74)');
      setText(val, fmt(v));
    }
  };
}

/* ---------------- 姿态仪：地平线 + 俯仰剪影 + 滚转外环 ---------------- */
function buildAttitude() {
  var wrap = el('div', 'gauge att');
  var svg = sv('svg', { viewBox: '0 0 148 148', width: 148, height: 148 }, wrap);
  var defs = sv('defs', {}, svg);
  var cp = sv('clipPath', { id: 'attClip' }, defs);
  sv('circle', { cx: 74, cy: 74, r: 60 }, cp);
  // 圆内：上黑 下深蓝灰
  var inner = sv('g', { 'clip-path': 'url(#attClip)' }, svg);
  sv('rect', { x: 8, y: 8, width: 132, height: 66, fill: '#05080c' }, inner);
  sv('rect', { x: 8, y: 74, width: 132, height: 66, fill: '#2c3945' }, inner);
  sv('line', { x1: 8, y1: 74, x2: 140, y2: 74, stroke: 'rgba(255,255,255,.5)', 'stroke-width': 1 }, inner);
  // 载具剪影（随 pitch 旋转）
  var sil = sv('g', {}, inner);
  sv('path', { d: 'M74 44 L77.5 56 L77.5 94 L70.5 94 L70.5 56 Z', fill: '#e8eef4' }, sil);
  sv('path', { d: 'M70.5 84 L63.5 97 L70.5 93 Z', fill: '#e8eef4' }, sil);
  sv('path', { d: 'M77.5 84 L84.5 97 L77.5 93 Z', fill: '#e8eef4' }, sil);
  // 滚转外环（随 roll 旋转）
  var roll = sv('g', {}, svg);
  sv('circle', { cx: 74, cy: 74, r: 68, fill: 'none', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 1 }, roll);
  for (var a = 0; a < 360; a += 30) {
    var rad = a * Math.PI / 180;
    sv('line', {
      x1: 74 + Math.cos(rad) * 62, y1: 74 + Math.sin(rad) * 62,
      x2: 74 + Math.cos(rad) * 68, y2: 74 + Math.sin(rad) * 68,
      stroke: 'rgba(255,255,255,.7)', 'stroke-width': 1.2
    }, roll);
  }
  sv('path', { d: 'M74 3 L77.5 10 L70.5 10 Z', fill: '#fff' }, svg); // 固定顶部指标
  return { wrap: wrap, sil: sil, roll: roll };
}

/* ---------------- 引擎仪：33 点阵(3/10/20) + 燃料弧 ---------------- */
function buildEngine() {
  var wrap = el('div', 'gauge eng');
  var svg = sv('svg', { viewBox: '0 0 148 148', width: 148, height: 148 }, wrap);
  var C = 2 * Math.PI * 66;
  sv('circle', { cx: 74, cy: 74, r: 66, fill: 'none', stroke: 'rgba(255,255,255,.14)', 'stroke-width': 3 }, svg);
  fuelArc = sv('circle', { cx: 74, cy: 74, r: 66, fill: 'none', stroke: '#fff', 'stroke-width': 3,
    'stroke-linecap': 'round', 'stroke-dasharray': '0 ' + C, transform: 'rotate(-90 74 74)' }, svg);
  engDots = [];
  var rings = [{ n: 3, r: 17 }, { n: 10, r: 34 }, { n: 20, r: 52 }];
  for (var i = 0; i < rings.length; i++) {
    var cfg = rings[i];
    for (var j = 0; j < cfg.n; j++) {
      var ang = -Math.PI / 2 + j * 2 * Math.PI / cfg.n;
      engDots.push(sv('circle', {
        cx: 74 + Math.cos(ang) * cfg.r, cy: 74 + Math.sin(ang) * cfg.r,
        r: 4.2, 'class': 'edot'
      }, svg));
    }
  }
  fuelTxt = sv('text', { x: 74, y: 72, 'text-anchor': 'middle', fill: '#fff',
    'font-size': 14, 'font-weight': 600, 'letter-spacing': 1 }, svg);
  fuelTxt.textContent = 'FUEL';
  var lab = sv('text', { x: 74, y: 86, 'text-anchor': 'middle',
    fill: 'rgba(255,255,255,.6)', 'font-size': 7.5, 'letter-spacing': 2 }, svg);
  lab.textContent = 'FUEL';
  return { wrap: wrap };
}

/* ============================================================
   引导文本映射表（覆盖全部阶段 × auto/manual）
   ============================================================ */
var PHASE_CN = {
  COUNTDOWN: '倒计时', LIFTOFF: '升空', PITCH_KICK: '程序转弯', 'MAX-Q': '最大动压',
  ASCENT: '上升', MECO: '主引擎关机', HOTSTAGE: '热分离',
  BOOSTBACK: '反推返回', BCOAST: '滑行', BENTRY: '再入点火', BLANDING: '着陆点火', RECOVERED: '已回收',
  SASCENT: '飞船上升', SECO: '飞船关机', ORBIT: '轨道滑行', DEORBIT: '离轨',
  REENTRY: '再入', FLIP: '着陆翻转', SLANDING: '着陆点火', LANDED: '已着陆'
};
var GUIDE = {
  auto: {
    stack: {
      COUNTDOWN: '自动程序：T-10s 点火，倒计时中…',
      LIFTOFF: '升空：33 台猛禽全推力，垂直上升',
      PITCH_KICK: '程序转弯：开始向下游方向俯仰',
      'MAX-Q': '最大动压：自动节流至 72% 减小载荷',
      ASCENT: '上升段：沿程序俯仰表继续爬升',
      MECO: 'MECO：助推器发动机关机',
      HOTSTAGE: '热分离：级间分离，飞船随即点火'
    },
    booster: {
      BOOSTBACK: '助推器：反推机动返回发射场方向',
      BCOAST: '助推器：弹道滑行，展开栅格舵',
      BENTRY: '再入点火：减速至安全速度',
      BLANDING: '着陆点火：减速下降，瞄准捕获塔',
      RECOVERED: '助推器已回收 ✓'
    },
    ship: {
      SASCENT: '飞船：继续爬升入轨',
      SECO: 'SECO：达到入轨速度，引擎关机',
      ORBIT: '轨道滑行：等待离轨窗口',
      DEORBIT: '离轨点火：反推约 12s 降低近地点',
      REENTRY: '再入：保持腹部朝下（俯仰≈90°）抗热',
      FLIP: '着陆翻转：由腹部朝下翻至尾朝下',
      SLANDING: '着陆点火：推力闭环垂直降落',
      LANDED: '飞船已着陆 ✓'
    }
  },
  manual: {
    stack: {
      COUNTDOWN: '按 E 点火发射（或拖动抽屉中油门滑条）',
      LIFTOFF: '保持垂直上升，稍后用 ↑↓ 控制俯仰',
      PITCH_KICK: '按 ↑（或俯仰滑条）向下游倾斜，跟随程序俯仰',
      'MAX-Q': '动压过高！建议按 S 收油门至 ~72%',
      ASCENT: '继续爬升：注意过载 ≤6.5g、动压 ≤45kPa',
      MECO: '燃料将尽：准备按 X 级间分离',
      HOTSTAGE: '已分离：按 TAB 切换载具分别控制'
    },
    booster: {
      BOOSTBACK: '按 E 点火反推，把 vx 拉回发射场方向',
      BCOAST: '按 G 展开栅格舵，微调弹道',
      BENTRY: '再入点火：按 E 点火减速至 ≤1350 m/s',
      BLANDING: '着陆点火：控制 vy≈-√y·0.62，姿态保持竖直',
      RECOVERED: '助推器已回收 ✓'
    },
    ship: {
      SASCENT: '爬升入轨：跟随程序俯仰 65km:25° → 140km:5°',
      SECO: '速度 ≥7650 m/s 且高度足够后按 E 关机',
      ORBIT: '轨道滑行中，等待离轨时机',
      DEORBIT: '按 E 点火反推约 12s，压低近地点',
      REENTRY: '保持腹部朝下(俯仰90°)控制再入角度，防止热流超限',
      FLIP: '按 F 翻转并适时按 E 点火着陆',
      SLANDING: '着陆点火：微调油门使 vy→0，接地 |vy|≤10',
      LANDED: '飞船已着陆 ✓'
    }
  }
};

/* ---------------- 教学卡片（5 页） ---------------- */
var TUT = [
  { t: '欢迎来到 STARSHIP FLIGHT 14',
    b: '本仿真完整再现星舰第 14 次试飞全流程：超重型助推器点火发射 → 级间热分离 → 助推器返回回收 → 飞船入轨 → 再入大气 → 垂直着陆。自动模式下全程自动驾驶，手动模式下由你掌控当前载具。' },
  { t: '仪表导览',
    b: '左下角：SPEED 速度表与 ALTITUDE 高度表，刻度环随数值旋转。中央：T+ 任务时钟与琥珀色事件播报。右下角：姿态仪（载具剪影随俯仰旋转、外环随滚转旋转）与引擎仪（33 台引擎点阵 + 外圈燃料余量弧）。' },
  { t: '控制与键位',
    b: 'W/S 油门；↑/↓ 俯仰；←/→ 偏航；Q/E 滚转；E 引擎点火/关机；G 栅格舵；F 着陆翻转；X 级间分离；TAB 切换载具；A 切换模式；P 暂停；H 呼出/收起底部控制面板（也可把鼠标移到屏幕底部边缘）。' },
  { t: '模式与失败机制',
    b: '自动演示：全体载具自动驾驶，观赏完整任务。手动驾驶：仅当前载具由你控制，其余保持自动。失败机制：过载 >6.5g、动压 >45kPa、再入热流超限、接地速度或姿态过猛都会导致任务失败——再入段务必保持腹部朝下。' },
  { t: '时间倍速',
    b: '压缩时间轴下，滑行/轨道等关键节奏自动加速（如 ORBIT 25×），关键时刻自动回到低速；也可用 1/2/3 键或顶部倍速按钮手动设定 1×/2×/5×。接近实时模式则以真实速度体验全程。祝飞行顺利！' }
];
var tutPage = 0;

/* ---------------- 键位表 ---------------- */
var KEY_ROWS = [
  ['W/S', '油门'], ['↑/↓', '俯仰'],
  ['←/→', '偏航'], ['Q/E', '滚转'],
  ['E', '引擎'], ['G', '栅格舵'],
  ['F', '着陆翻转'], ['X', '级间分离'],
  ['TAB', '切换载具'], ['A', '模式'],
  ['1/2/3', '倍速'], ['P', '暂停'],
  ['R', '重新飞行'], ['H', '控制面板']
];

/* ============================================================
   DOM 构建
   ============================================================ */
function buildHud() {
  $.hud = el('div', '', root); $.hud.id = 'hud';
  var left = el('div', 'hud-side', $.hud);
  gaugeSpeed = buildGauge('SPEED', 'KM/H', 30000, function (v) { return String(Math.round(v)); });
  gaugeAlt = buildGauge('ALTITUDE', 'KM', 200, function (v) { return (Math.max(0, v)).toFixed(1); });
  left.appendChild(gaugeSpeed.wrap);
  left.appendChild(gaugeAlt.wrap);

  var center = el('div', 'hud-center', $.hud);
  var arc = sv('svg', { 'class': 'hud-arc', viewBox: '0 0 540 34', preserveAspectRatio: 'none' }, center);
  sv('path', { d: 'M2 32 Q270 -14 538 32', fill: 'none', stroke: 'rgba(255,255,255,.8)', 'stroke-width': 1 }, arc);
  var clockRow = el('div', 'clock-row', center);
  $.tSign = el('span', 't-sign', clockRow, 'T+');
  $.clock = el('span', 't-val', clockRow, '00:00');
  $.flightName = el('div', 'flight-name', center, 'STARSHIP FLIGHT 14');
  el('div', 'vehicle-sub', center, 'SUPER HEAVY / STARSHIP');
  $.ticker = el('div', 'ticker', center, '');

  var right = el('div', 'hud-side', $.hud);
  $.att = buildAttitude(); right.appendChild($.att.wrap);
  $.eng = buildEngine(); right.appendChild($.eng.wrap);
}

function buildChips() {
  $.chips = el('div', '', root); $.chips.id = 'chips';
  $.chipMode = el('div', 'chip', $.chips, 'AUTO');
  $.chipMode.addEventListener('click', function () { if (cb) cb.onCmd('mode'); });
  var seg = el('div', 'chip-seg', $.chips);
  $.speedChips = {};
  [1, 2, 5].forEach(function (n) {
    var c = el('div', 'chip', seg, n + '×');
    c.addEventListener('click', function () { if (cb) cb.onCmd('speed', n); });
    $.speedChips[n] = c;
  });
  $.chipReal = el('div', 'chip', seg, '真实');
  $.chipReal.addEventListener('click', function () { if (cb) cb.onCmd('realspeed'); });
  $.chipPause = el('div', 'chip', $.chips, '暂停');
  $.chipPause.addEventListener('click', function () { if (cb) cb.onCmd('pause'); });
  $.chipSound = el('div', 'chip', $.chips, '声音 开');
  $.chipSound.addEventListener('click', function () { toggleMute(); });
  $.chipPanel = el('div', 'chip', $.chips, '控制面板');
  $.chipPanel.addEventListener('click', function () { toggleDrawer(true); });
}

/* ---- 抽屉控制面板 ---- */
function buildDrawer() {
  $.dock = el('div', '', root); $.dock.id = 'dock';
  $.drawer = el('div', '', $.dock); $.drawer.id = 'drawer';
  $.hotspot = el('div', '', $.dock); $.hotspot.id = 'hotspot';

  /* 第 0 栏：任务参数（IFT-14 新增） */
  var c0 = el('div', 'd-col', $.drawer);
  el('div', 'd-head', c0, '任务参数 PARAMS');
  $.dpRows = {};
  if (typeof MISSION14 !== 'undefined') {
    MISSION14.PARAM_DEFS.forEach(function (def) {
      $.dpRows[def.key] = mkParamRow(c0, def, true, pendingParams);
    });
  }
  var pmBtns = el('div', 'd-btns', c0);
  $.dpModeScript = mkBtn(pmBtns, '脚本模式', function () {
    paramModeSel = 'script';
    if (cb) cb.onCmd('paramMode', { value: 'script' });
  });
  $.dpModeAdaptive = mkBtn(pmBtns, '自适应', function () {
    paramModeSel = 'adaptive';
    if (cb) cb.onCmd('paramMode', { value: 'adaptive' });
  });

  /* 第 1 栏：飞行控制 */
  var c1 = el('div', 'd-col', $.drawer);
  el('div', 'd-head', c1, '飞行控制 FLIGHT CTRL');
  $.slThr = mkSlider(c1, '油门 THR', 0, 100, 1, '%', function (v) {
    drag.thr = performance.now();
    if (cb) cb.onCmd('throttle', v / 100);
  });
  $.slPitch = mkSlider(c1, '俯仰 PITCH', -180, 180, 1, '°', function (v) {
    drag.pitch = performance.now();
    if (cb) cb.onCmd('pitch', v);   // 直接设值（见报告：契约外扩展）
  });
  $.slYaw = mkStick(c1, '偏航 YAW', 'yaw');
  $.slRoll = mkStick(c1, '滚转 ROLL', 'roll');
  var btns = el('div', 'd-btns', c1);
  $.btnEng = mkBtn(btns, '引擎点火 (E)', function () { if (cb) cb.onCmd('engines'); });
  $.btnFins = mkBtn(btns, '栅格舵 (G)', function () { if (cb) cb.onCmd('fins'); });
  $.btnFlip = mkBtn(btns, '着陆翻转 (F)', function () { if (cb) cb.onCmd('flip'); });
  $.btnSep = mkBtn(btns, '级间分离 (X)', function () { if (cb) cb.onCmd('sep'); });
  $.btnSwitch = mkBtn(btns, '切换载具 (TAB)', function () { if (cb) cb.onCmd('switch'); });
  $.btnSwitch.classList.add('wide');
  $.btnAssist = mkBtn(btns, 'RCS 辅助', function () { if (cb) cb.onCmd('assist'); });
  $.btnAssist.classList.add('wide');

  /* 第 2 栏：引导文本 */
  var c2 = el('div', 'd-col', $.drawer);
  el('div', 'd-head', c2, '引导 GUIDANCE');
  var g = el('div', '', c2); g.id = 'guidance';
  $.gPhase = el('div', 'g-phase', g, '');
  $.gText = el('div', 'g-text', g, '—');

  /* 第 3 栏：任务清单 */
  var c3 = el('div', 'd-col', $.drawer);
  el('div', 'd-head', c3, '任务清单 CHECKLIST');
  $.checklist = el('div', '', c3); $.checklist.id = 'checklist';
  $.ckItems = [];

  /* 第 4 栏：键位表 */
  var c4 = el('div', 'd-col', $.drawer);
  el('div', 'd-head', c4, '键位 KEYS');
  var kg = el('div', 'keys', c4);
  KEY_ROWS.forEach(function (r) {
    var cell = el('div', '', kg);
    var b = el('b', '', cell, r[0]);
    cell.appendChild(document.createTextNode(r[1]));
  });

  /* 抽屉开合交互 */
  $.hotspot.addEventListener('mouseenter', function () { openDrawer(false); });
  $.drawer.addEventListener('mouseenter', function () { openDrawer(false); });
  $.hotspot.addEventListener('mouseleave', scheduleDrawerClose);
  $.drawer.addEventListener('mouseleave', scheduleDrawerClose);
}
function mkSlider(parent, label, min, max, step, unit, onInput) {
  var row = el('div', 'srow', parent);
  el('label', '', row, label);
  var inp = el('input', '', row);
  inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = min;
  var val = el('span', 'sval', row, '0' + unit);
  inp.addEventListener('input', function () {
    var v = +inp.value;
    setText(val, v + unit);
    onInput(v);
  });
  inp.addEventListener('change', function () { inp.blur(); });
  row.__inp = inp; row.__val = val; row.__unit = unit;
  return row;
}
function mkStick(parent, label, axis) {   // 偏航/滚转：按住拖动 = 持续输入，松手归零
  var row = mkSlider(parent, label, -100, 100, 5, '', function () {});
  row.__inp.addEventListener('input', function () {
    var v = +row.__inp.value;
    setText(row.__val, String(v));
    if (cb) cb.onInput(axis, v / 100);
  });
  function release() {
    row.__inp.value = 0;
    setText(row.__val, '0');
    if (cb) cb.onInput(axis, 0);
    row.__inp.blur();
  }
  row.__inp.addEventListener('change', release);
  row.__inp.addEventListener('pointerup', release);
  row.__stick = axis;
  return row;
}
function mkBtn(parent, label, onClick) {
  var b = el('button', 'd-btn', parent, label);
  b.addEventListener('click', function () { onClick(); b.blur(); });
  return b;
}

/* ---- 主菜单 ---- */
function buildMenu() {
  $.menu = el('div', 'overlay', root); $.menu.id = 'menu';
  var box = el('div', 'menu-box', $.menu);
  var arc = sv('svg', { 'class': 'menu-arc', viewBox: '0 0 520 64' }, box);
  sv('path', { d: 'M10 58 Q260 -12 510 58', fill: 'none', stroke: 'rgba(255,255,255,.85)', 'stroke-width': 1.5 }, arc);
  sv('line', { x1: 260, y1: 16, x2: 260, y2: 26, stroke: '#fff', 'stroke-width': 1.5 }, arc);
  el('div', 'menu-title', box, 'STARSHIP FLIGHT 14');
  el('div', 'menu-sub', box, '星舰全任务飞行仿真');

  $.optMode = mkSeg(box, '模式 MODE', [
    { v: 'auto', label: '自动演示' }, { v: 'manual', label: '手动驾驶' }
  ], menuCfg.mode, function (v) {
    menuCfg.mode = v;
    $.optRec.root.style.display = (v === 'manual') ? '' : 'none';
  });
  $.optTime = mkSeg(box, '时间 TIME', [
    { v: 'compressed', label: '压缩时间轴' }, { v: 'real', label: '接近实时' }
  ], menuCfg.timeMode, function (v) { menuCfg.timeMode = v; });
  $.optRec = mkSeg(box, '助推器回收 RECOVERY', [
    { v: 0, label: '溅落美洲湾（真实）' }, { v: 1, label: '发射塔捕获' }
  ], menuCfg.recovery, function (v) { menuCfg.recovery = v; });
  $.optRec.root.style.display = 'none';  // 默认自动模式不显示

  var start = el('button', 'btn-start', box, '开 始 任 务');
  start.addEventListener('click', onStartClick);
  el('div', 'menu-hint', box, 'ENTER 开始 · 手动模式 W/S 油门 · H 控制面板');
}
function mkSeg(parent, label, options, cur, onPick) {
  var row = el('div', 'opt-group', parent);
  el('div', 'opt-label', row, label);
  var obj = { root: row, map: {} };
  options.forEach(function (o) {
    var b = el('button', 'seg', row, o.label);
    if (o.v === cur) b.classList.add('active');
    b.addEventListener('click', function () {
      Object.keys(obj.map).forEach(function (k) { obj.map[k].classList.remove('active'); });
      b.classList.add('active');
      onPick(o.v);
    });
    obj.map[o.v] = b;
  });
  return obj;
}
function onStartClick() {
  var cfg = { mode: menuCfg.mode, timeMode: menuCfg.timeMode, recovery: menuCfg.recovery };
  var seen = false;
  try { seen = !!localStorage.getItem('starship14_tut_seen'); } catch (e) {}
  if (seen) { openBriefing(cfg); }
  else {
    pendingCfg = cfg; tutPage = 0; tutVisible = true;
    $.tut.classList.remove('hidden');
    renderTut();
  }
}
function launch(cfg) {
  menuVisible = false;
  briefVisible = false;
  if ($.briefing) $.briefing.classList.add('hidden');
  $.menu.classList.add('hidden');
  initAudio();
  if (cb) cb.onStart(cfg);
}
function finishTut() {
  tutVisible = false;
  $.tut.classList.add('hidden');
  try { localStorage.setItem('starship14_tut_seen', '1'); } catch (e) {}
  if (pendingCfg) { var c = pendingCfg; pendingCfg = null; openBriefing(c); }
}

/* ---- IFT-14 任务简报（弹道剖面 + 参数编辑） ---- */
var PROF_X = [[-30, 12], [0, 42], [140, 96], [421, 152], [491, 186], [1547, 242], [3890, 296], [31938, 376], [34132, 430], [35430, 546]];
var PROF_Y = [[-17, 0], [0, 0], [58, 14], [140, 65], [142, 65], [187, 88], [300, 62], [421, 2], [491, 90], [900, 130], [1547, 275], [31938, 275], [34132, 100], [35250, 16], [35413, 4], [35430, 0]];
function profX(t) {
  if (t <= PROF_X[0][0]) return PROF_X[0][1];
  for (var i = 1; i < PROF_X.length; i++) {
    if (t <= PROF_X[i][0]) {
      var a = PROF_X[i - 1], b = PROF_X[i];
      return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    }
  }
  return PROF_X[PROF_X.length - 1][1];
}
function profY(alt) { return 238 - clamp(alt, 0, 290) / 290 * 224; }
function buildProfileSVG(parent) {
  var svg = sv('svg', { 'class': 'brief-svg', viewBox: '0 0 560 258' }, parent);
  sv('line', { x1: 10, y1: 240, x2: 550, y2: 240, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 1 }, svg);
  // 高度网格线
  [65, 130, 275].forEach(function (km) {
    sv('line', { x1: 10, y1: profY(km), x2: 550, y2: profY(km), stroke: 'rgba(255,255,255,.09)', 'stroke-width': 1 }, svg);
    var t = sv('text', { x: 12, y: profY(km) - 3, fill: 'rgba(255,255,255,.3)', 'font-size': 8 }, svg);
    t.textContent = km + 'km';
  });
  // 弹道折线
  var d = '';
  PROF_Y.forEach(function (p, i) {
    d += (i ? 'L' : 'M') + profX(p[0]).toFixed(1) + ' ' + profY(p[1]).toFixed(1) + ' ';
  });
  sv('path', { d: d, fill: 'none', stroke: 'rgba(255,255,255,.9)', 'stroke-width': 1.6 }, svg);
  // 节点
  if (typeof MISSION14 !== 'undefined') {
    MISSION14.TIMELINE.forEach(function (nd) {
      var altP = null;
      for (var i = 0; i < PROF_Y.length - 1; i++) {
        if (nd.t >= PROF_Y[i][0] && nd.t <= PROF_Y[i + 1][0]) {
          var a = PROF_Y[i], b2 = PROF_Y[i + 1];
          altP = a[1] + (b2[1] - a[1]) * (nd.t - a[0]) / Math.max(1e-9, b2[0] - a[0]);
          break;
        }
      }
      if (altP === null) altP = 0;
      var x = profX(nd.t), y = profY(altP);
      sv('circle', { cx: x, cy: y, r: 3, fill: '#fff' }, svg);
      var tip = sv('g', {}, svg);
      tip.style.pointerEvents = 'all';
      sv('circle', { cx: x, cy: y, r: 12, fill: 'transparent' }, tip);
      var tt = sv('text', { x: clamp(x, 60, 480), y: clamp(y - 10, 12, 250), 'text-anchor': 'middle',
        fill: 'rgba(255,255,255,.55)', 'font-size': 8.5, 'letter-spacing': 1, 'pointer-events': 'none' }, svg);
      tt.textContent = nd.name + ' ' + MISSION14.fmtClock(nd.t);
      var title = sv('title', {}, tip);
      title.textContent = nd.name + '（' + MISSION14.fmtClock(nd.t) + '）' + nd.desc;
    });
  }
  // 时间刻度
  [[0, 'T+0'], [140, '2:20'], [421, '7:01'], [1547, '25:47'], [3890, '1:04'], [31938, '8:52'], [34132, '9:28'], [35430, '9:50']].forEach(function (k) {
    var x = profX(k[0]);
    sv('line', { x1: x, y1: 240, x2: x, y2: 245, stroke: 'rgba(255,255,255,.5)', 'stroke-width': 1 }, svg);
    var t2 = sv('text', { x: x, y: 255, 'text-anchor': 'middle', fill: 'rgba(255,255,255,.45)', 'font-size': 8 }, svg);
    t2.textContent = k[1];
  });
  return svg;
}
/* 参数行（简报完整版 / 抽屉紧凑版共用） */
function mkParamRow(parent, def, compact, store) {
  var row = el('div', 'prow' + (compact ? ' pcompact' : ''), parent);
  var lab = el('label', '', row, def.label);
  if (!compact && def.desc) lab.title = def.desc;
  var val = el('span', 'pval', row, '');
  var ref = { row: row, val: val, def: def, inp: null, btns: null };
  function apply(v) {
    pendingParams[def.key] = v;
    if ($.bpRows[def.key]) $.bpRows[def.key].set(v);
    if ($.dpRows[def.key]) $.dpRows[def.key].set(v);
  }
  if (def.type === 'select') {
    ref.btns = [];
    def.options.forEach(function (opt, i) {
      var b = el('button', 'pseg', row, opt);
      b.addEventListener('click', function () { apply(i); b.blur(); });
      ref.btns.push(b);
    });
  } else {
    var inp = el('input', '', row);
    inp.type = 'range'; inp.min = def.min; inp.max = def.max; inp.step = def.step; inp.value = def.def;
    inp.addEventListener('input', function () { apply(+inp.value); });
    ref.inp = inp;
  }
  ref.set = function (v) {
    if (ref.btns) {
      ref.btns.forEach(function (b, i) { b.classList.toggle('active', i === v); });
      setText(val, def.options[v] || '');
    } else if (ref.inp) {
      if (document.activeElement !== ref.inp) ref.inp.value = v;
      setText(val, (def.step < 1 ? (+v).toFixed(2) : v) + (def.unit || ''));
    }
  };
  ref.set(store[def.key]);
  return ref;
}
function buildBriefing() {
  $.briefing = el('div', 'overlay hidden', root); $.briefing.id = 'briefing';
  var card = el('div', 'brief-card', $.briefing);
  var head = el('div', 'brief-head', card);
  el('div', 'brief-kicker', head, 'MISSION BRIEFING');
  el('div', 'brief-title', head, 'IFT-14 任务简报');
  el('div', 'brief-date', head, '2026-09-28 · STARBASE · 首次入轨 · 26×STARLINK V3 · 全任务 9H50M');
  var body = el('div', 'brief-body', card);
  var left = el('div', 'brief-left', body);
  el('div', 'brief-sec', left, '任务剖面 TRAJECTORY');
  buildProfileSVG(left);
  el('div', 'brief-note', left, '悬停节点查看说明 · 真实时间线 9 小时 50 分，智能压缩播放约 10 分钟 · 倍速面板可切换 1× 真实时间');
  var right = el('div', 'brief-right', body);
  el('div', 'brief-sec', right, '任务参数 PARAMS');
  $.bpRows = {};
  if (typeof MISSION14 !== 'undefined') {
    MISSION14.PARAM_DEFS.forEach(function (def) {
      $.bpRows[def.key] = mkParamRow(right, def, false, pendingParams);
    });
  }
  $.briefMode = mkSeg(right, '飞行程序 PROGRAM', [
    { v: 'script', label: '脚本模式（真实时间线）' }, { v: 'adaptive', label: '自适应模式' }
  ], paramModeSel, function (v) { paramModeSel = v; });
  $.briefMode.root.classList.add('brief-mode');
  var foot = el('div', 'brief-foot', card);
  el('div', 'brief-hint', foot, '自适应模式下，参数可在飞行中于控制面板（H）内实时调整');
  var go = el('button', 'btn-start brief-go', foot, '发 射');
  go.addEventListener('click', briefingLaunch);
}
function openBriefing(cfg) {
  pendingCfg = cfg;
  briefVisible = true;
  $.briefing.classList.remove('hidden');
}
function briefingLaunch() {
  var cfg = pendingCfg || { mode: 'auto', timeMode: 'compressed', recovery: 0 };
  cfg.params = JSON.parse(JSON.stringify(pendingParams));
  cfg.paramMode = paramModeSel;
  pendingCfg = null;
  launch(cfg);
}

/* ---- 教学弹窗 ---- */
function buildTut() {
  $.tut = el('div', 'overlay hidden', root); $.tut.id = 'tut';
  var card = el('div', 'tut-card', $.tut);
  var head = el('div', 'tut-head', card);
  el('span', '', head, '飞行教学 TUTORIAL');
  $.tutPageNo = el('span', '', head, '1 / 5');
  $.tutBody = el('div', 'tut-body', card);
  var foot = el('div', 'tut-foot', card);
  $.tutSkip = el('button', 'btn-ghost', foot, '跳过');
  $.tutDots = el('div', 'tut-dots', foot);
  $.tutDotsEls = [];
  for (var i = 0; i < TUT.length; i++) $.tutDotsEls.push(el('i', '', $.tutDots));
  $.tutPrev = el('button', 'btn-ghost', foot, '上一页');
  $.tutNext = el('button', 'btn-primary', foot, '下一页');
  $.tutSkip.addEventListener('click', finishTut);
  $.tutPrev.addEventListener('click', function () { if (tutPage > 0) { tutPage--; renderTut(); } });
  $.tutNext.addEventListener('click', function () {
    if (tutPage < TUT.length - 1) { tutPage++; renderTut(); }
    else finishTut();
  });
}
function renderTut() {
  var p = TUT[tutPage];
  $.tutBody.innerHTML = '';
  el('h3', '', $.tutBody, p.t);
  el('p', '', $.tutBody, p.b);
  setText($.tutPageNo, (tutPage + 1) + ' / ' + TUT.length);
  for (var i = 0; i < $.tutDotsEls.length; i++)
    $.tutDotsEls[i].classList.toggle('on', i === tutPage);
  $.tutPrev.disabled = (tutPage === 0);
  setText($.tutNext, tutPage === TUT.length - 1 ? '开始任务' : '下一页');
}

/* ---- 结局弹窗 ---- */
function buildEnd() {
  $.end = el('div', 'overlay hidden', root); $.end.id = 'end';
  $.endCard = el('div', 'end-card', $.end);
  $.endTitle = el('div', 'end-title', $.endCard, '');
  $.endNote = el('div', 'end-note', $.endCard, '');
  var stats = el('div', 'end-stats', $.endCard);
  $.statEls = {};
  [['time', '任务时长'], ['alt', '最高高度 KM'], ['spd', '最大速度 KM/H'], ['g', '最大过载 G']].forEach(function (d) {
    var cell = el('div', 'stat', stats);
    $.statEls[d[0]] = el('b', '', cell, '—');
    el('span', '', cell, d[1]);
  });
  var btns = el('div', 'end-btns', $.endCard);
  var br = el('button', '', btns, '重新飞行'); br.id = 'btnRestart';
  var bm = el('button', '', btns, '返回主菜单'); bm.id = 'btnMenu';
  br.addEventListener('click', function () {
    endVisible = false; $.end.classList.add('hidden');
    if (cb) cb.onRestart();
  });
  bm.addEventListener('click', function () {
    endVisible = false; $.end.classList.add('hidden');
    menuVisible = true; $.menu.classList.remove('hidden');
    if (cb) cb.onMenu();
  });
}

/* ---- 侧边时间线路线图（IFT-14 新增） ---- */
function railFrac(t) {
  var K = [[-30, 0], [0, 0.05], [140, 0.13], [421, 0.23], [491, 0.29], [1547, 0.41], [3890, 0.54], [31938, 0.71], [34132, 0.81], [35250, 0.9], [35430, 0.97]];
  if (t <= K[0][0]) return 0;
  for (var i = 1; i < K.length; i++) {
    if (t <= K[i][0]) {
      var a = K[i - 1], b = K[i];
      return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    }
  }
  return 1;
}
function buildRail() {
  $.rail = el('div', '', root); $.rail.id = 'rail';
  $.railLine = el('div', 'rail-line', $.rail);
  $.railCursor = el('div', 'rail-cursor', $.rail);
  $.railNodes = [];
  if (typeof MISSION14 !== 'undefined') {
    MISSION14.TIMELINE.forEach(function (nd) {
      var n = el('div', 'rail-node', $.rail);
      n.style.top = (railFrac(nd.t) * 100).toFixed(2) + '%';
      el('i', 'rail-dot', n);
      el('span', 'rail-lab', n, MISSION14.fmtClock(nd.t) + '  ' + nd.name);
      el('div', 'rail-tip', n, nd.name + ' · ' + MISSION14.fmtClock(nd.t) + ' — ' + nd.desc);
      n.addEventListener('mouseenter', function () { n.classList.add('hover'); });
      n.addEventListener('mouseleave', function () { n.classList.remove('hover'); });
      $.railNodes.push({ el: n, t: nd.t, id: nd.id });
    });
  }
  $.railToggle = el('div', 'chip', root, '时间线');
  $.railToggle.id = 'rail-toggle';
  $.railToggle.addEventListener('click', function () { $.rail.classList.toggle('open'); });
}

/* ---- Toast 容器 ---- */
function buildToasts() {
  $.toasts = el('div', '', root); $.toasts.id = 'toasts';
}
function pushToast(text) {
  if (!text) return;
  while ($.toasts.children.length >= 4) $.toasts.removeChild($.toasts.firstChild);
  var t = el('div', 'toast', $.toasts, text);
  void t.offsetWidth;      // 触发重排后再加类，保证过渡播放
  t.classList.add('in');
  setTimeout(function () {
    t.classList.add('out');
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 500);
  }, 5000);
}

/* ============================================================
   UI.init(cb)
   ============================================================ */
function init(cbIn) {
  cb = cbIn;
  if (!document.body) {
    setTimeout(function () { init(cbIn); }, 20);
    return;
  }
  root = el('div', '', document.body); root.id = 'ui-root';
  root.classList.add('menu-open');
  buildHud();
  buildChips();
  buildDrawer();
  buildRail();
  buildMenu();
  buildBriefing();
  buildTut();
  buildEnd();
  buildToasts();
  bindKeyboard();
}

/* ============================================================
   抽屉开合
   ============================================================ */
function openDrawer(pin) {
  clearTimeout(drawerTimer);
  drawerOpen = true;
  if (pin) drawerPinned = true;
  $.drawer.classList.add('open');
}
function closeDrawer() {
  clearTimeout(drawerTimer);
  drawerOpen = false; drawerPinned = false;
  $.drawer.classList.remove('open');
}
function scheduleDrawerClose() {
  if (drawerPinned) return;
  clearTimeout(drawerTimer);
  drawerTimer = setTimeout(closeDrawer, 1500);
}
function toggleDrawer(pin) {
  if (drawerOpen) closeDrawer();
  else openDrawer(pin !== false);
}

/* ============================================================
   键盘
   ============================================================ */
var PREVENT = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, Tab: 1 };
function bindKeyboard() {
  window.addEventListener('keydown', function (e) {
    if (PREVENT[e.code]) e.preventDefault();
    if (menuVisible) {                      // 菜单中仅 Enter 开始
      if (briefVisible) {                   // 简报中 Enter 发射 / Esc 返回
        if (e.code === 'Enter' && !e.repeat) briefingLaunch();
        if (e.code === 'Escape') {
          briefVisible = false;
          $.briefing.classList.add('hidden');
        }
        return;
      }
      if (e.code === 'Enter' && !e.repeat && !tutVisible) onStartClick();
      return;
    }
    if (tutVisible) {
      if (e.code === 'Enter' || e.code === 'Space') {
        if (tutPage < TUT.length - 1) { tutPage++; renderTut(); } else finishTut();
      }
      if (e.code === 'Escape') finishTut();
      return;
    }
    if (endVisible) {                       // 结局弹窗仅 R 重飞
      if (e.code === 'KeyR' && !e.repeat && cb) cb.onRestart();
      return;
    }
    keys[e.code] = true;
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyE': if (cb) cb.onCmd('engines'); break;   // 点按点火；按住兼作滚转（见报告）
      case 'KeyG': if (cb) cb.onCmd('fins'); break;
      case 'KeyF': if (cb) cb.onCmd('flip'); break;
      case 'KeyX': if (cb) cb.onCmd('sep'); break;
      case 'Tab': if (cb) cb.onCmd('switch'); break;
      case 'KeyA': if (cb) cb.onCmd('mode'); break;
      case 'KeyP': if (cb) cb.onCmd('pause'); break;
      case 'KeyR': if (cb) cb.onRestart(); break;
      case 'KeyH': toggleDrawer(true); break;
      case 'KeyT': if ($.rail) $.rail.classList.toggle('open'); break;
      case 'Digit1': if (cb) cb.onCmd('speed', 1); break;
      case 'Digit2': if (cb) cb.onCmd('speed', 2); break;
      case 'Digit3': if (cb) cb.onCmd('speed', 5); break;
    }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; });
}

/* 每帧 flush 持续输入（主循环每帧都调 UI.update） */
function flushInputs() {
  if (!cb) return;
  var p = (keys.ArrowUp ? 1 : 0) + (keys.ArrowDown ? -1 : 0);
  var y = (keys.ArrowRight ? 1 : 0) + (keys.ArrowLeft ? -1 : 0);
  var r = (keys.KeyE ? 1 : 0) + (keys.KeyQ ? -1 : 0);
  sendInput('pitch', p);
  sendInput('yaw', y);
  sendInput('roll', r);
  var now = performance.now();
  var dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if ((keys.KeyW || keys.KeyS) && state && !state.paused) {   // W/S 油门连续步进
    var veh = actVeh();
    if (veh) {
      var dir = keys.KeyW ? 1 : -1;
      var nv = clamp((veh.throttle || 0) + dir * 0.6 * dt, 0, 1);
      cb.onCmd('throttle', nv);
    }
  }
}
function sendInput(k, v) {
  if (lastInput[k] !== v) { lastInput[k] = v; cb.onInput(k, v); }
}

/* ============================================================
   音效：WebAudio 噪声 + 低通 = 引擎轰鸣
   音量 = throttle · min(1, rho/1.2)，rho=1.225·e^(-y/8500)
   ============================================================ */
function initAudio() {
  if (audio) { try { audio.ctx.resume(); } catch (e) {} return; }
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    var len = 2 * ctx.sampleRate;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 110; filt.Q.value = 0.7;
    var g = ctx.createGain(); g.gain.value = 0;
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start();
    audio = { ctx: ctx, gain: g, filt: filt };
  } catch (e) { audio = null; }
}
function toggleMute() {
  muted = !muted;
  setText($.chipSound, muted ? '声音 关' : '声音 开');
  $.chipSound.classList.toggle('warn', muted);
}
function updateAudio() {
  if (!audio) return;
  var vol = 0, freq = 100;
  if (state && state.running && !state.paused && !state.missionOver && !muted) {
    var veh = actVeh();
    if (veh && veh.throttle > 0 && veh.alive !== false) {
      var rho = 1.225 * Math.exp(-(veh.y || 0) / 8500);
      vol = veh.throttle * Math.min(1, rho / 1.2);
      freq = 90 + veh.throttle * 260;
    }
  }
  try {
    var t = audio.ctx.currentTime;
    audio.gain.gain.setTargetAtTime(Math.min(0.55, vol * 0.5), t, 0.12);
    audio.filt.frequency.setTargetAtTime(freq, t, 0.2);
  } catch (e) {}
}

/* ============================================================
   引导文本 / 清单
   ============================================================ */
function updateGuidance() {
  if (!state || !state.running || state.missionOver) {
    setText($.gPhase, ''); setText($.gText, '—'); lastGuide = '';
    return;
  }
  var phase = state.phases && state.phases[state.active];
  var mode = state.mode || 'auto';
  var kind = state.active || 'stack';
  var txt = (GUIDE[mode] && GUIDE[mode][kind] && GUIDE[mode][kind][phase]) || '任务进行中…';
  var sig = mode + '|' + kind + '|' + phase;
  if (sig !== lastGuide) {
    lastGuide = sig;
    var cn = PHASE_CN[phase] || phase || '—';
    setText($.gPhase, (mode === 'manual' ? '手动' : '自动') + ' · ' +
      String(kind).toUpperCase() + ' · ' + cn + (phase ? ' / ' + phase : ''));
    setText($.gText, txt);
  }
}
function updateChecklist() {
  var items = null;
  try {
    if (window.PHYS && typeof PHYS.checklist === 'function') items = PHYS.checklist();
  } catch (e) {}
  if (!items || !items.length) return;
  var sig = items.map(function (i) { return (i.done ? '1' : '0') + (i.now ? 'n' : '0'); }).join('');
  if (sig === lastCkSig) return;
  lastCkSig = sig;
  if ($.ckItems.length !== items.length) {   // 首次或数量变化时重建
    $.checklist.innerHTML = '';
    $.ckItems = [];
    for (var i = 0; i < items.length; i++) {
      var row = el('div', 'ck-item', $.checklist);
      $.ckItems.push({ row: row, mark: el('span', 'ck-mark', row, ''), name: el('span', '', row, '') });
    }
  }
  for (var j = 0; j < items.length; j++) {
    var it = items[j], ref = $.ckItems[j];
    setText(ref.name, it.name);
    setText(ref.mark, it.done ? '✓' : (it.now ? '▸' : '·'));
    ref.row.classList.toggle('done', !!it.done);
    ref.row.classList.toggle('now', !!it.now && !it.done);
  }
}

/* ============================================================
   UI.update(state) — 每帧刷新（预建引用，仅改文本/属性）
   ============================================================ */
function update(st) {
  state = st;
  if (!root) return;
  flushInputs();

  /* overlay 状态类 */
  root.classList.toggle('menu-open', menuVisible);
  root.classList.toggle('end-open', endVisible);

  var veh = actVeh();

  /* 左侧仪表 */
  var spd = veh ? Math.hypot(veh.vx || 0, veh.vy || 0) * 3.6 : 0;
  var alt = veh ? Math.max(0, (veh.y || 0) / 1000) : 0;
  gaugeSpeed.set(spd);
  gaugeAlt.set(alt);

  /* 任务时钟 */
  setText($.tSign, (st.simTime || 0) < 0 ? 'T-' : 'T+');
  setText($.clock, fmtClock(st.simTime));

  /* 事件 ticker（最新一条，8s 淡出） */
  var evs = st.events || [];
  if (evs.length < eventCount) eventCount = 0;   // 重开后重置
  if (evs.length > eventCount) {
    var ev = evs[evs.length - 1];
    setText($.ticker, ev.text || '');
    $.ticker.classList.remove('anim');
    void $.ticker.offsetWidth;
    $.ticker.classList.add('anim');
    eventCount = evs.length;
  }

  /* 姿态仪 */
  if (veh) {
    $.att.sil.setAttribute('transform', 'rotate(' + (veh.pitch || 0).toFixed(1) + ' 74 74)');
    $.att.roll.setAttribute('transform', 'rotate(' + (veh.roll || 0).toFixed(1) + ' 74 74)');
  }

  /* 引擎点阵 + 燃料弧 */
  var lit = !!(veh && veh.engines && (veh.throttle || 0) > 0.02);
  if (lit !== lastLit) {
    lastLit = lit;
    for (var i = 0; i < engDots.length; i++) engDots[i].classList.toggle('on', lit);
  }
  var f = (veh && veh.fuelMax > 0) ? clamp(veh.fuel / veh.fuelMax, 0, 1) : 0;
  var C = 2 * Math.PI * 66;
  fuelArc.setAttribute('stroke-dasharray', Math.max(0.001, C * f).toFixed(1) + ' ' + C.toFixed(1));
  var ft = Math.round(f * 100) + '%';
  if (ft !== fuelTxtVal) { fuelTxtVal = ft; setText(fuelTxt, ft); }

  /* 顶部 chips */
  var modeTxt = st.mode === 'manual' ? 'MANUAL' : 'AUTO';
  setText($.chipMode, modeTxt);
  $.chipMode.classList.toggle('manual', st.mode === 'manual');
  $.speedChips[1].classList.toggle('active', st.userSpeed === 1 && !st.realspeed);
  $.speedChips[2].classList.toggle('active', st.userSpeed === 2 && !st.realspeed);
  $.speedChips[5].classList.toggle('active', st.userSpeed === 5 && !st.realspeed);
  $.chipReal.classList.toggle('active', !!st.realspeed);
  setText($.chipPause, st.paused ? '已暂停' : '暂停');
  $.chipPause.classList.toggle('warn', !!st.paused);

  /* 侧边时间线路线图 */
  if ($.rail) {
    $.railCursor.style.top = (railFrac(st.simTime || 0) * 100).toFixed(2) + '%';
    var curId = null;
    for (var rn = 0; rn < $.railNodes.length; rn++) {
      var nd = $.railNodes[rn];
      var done = !!(st.timelineDone && st.timelineDone[nd.id]);
      nd.el.classList.toggle('done', done);
      if (done) curId = nd.id;
    }
    for (var rn2 = 0; rn2 < $.railNodes.length; rn2++) {
      $.railNodes[rn2].el.classList.toggle('cur', $.railNodes[rn2].id === curId);
    }
  }

  /* 抽屉内容 */
  updateGuidance();
  updateChecklist();
  if (drawerOpen) updateDrawer(veh, st);

  /* 系统级 toast（PHYS 推入的重要提示） */
  var ts = st.toasts || [];
  if (ts.length < toastCount) toastCount = 0;
  while (toastCount < ts.length) { pushToast(ts[toastCount].text); toastCount++; }

  updateAudio();
}

/* 抽屉内控件逐帧同步（不覆盖正在拖动的滑条） */
function updateDrawer(veh, st) {
  var now = performance.now();
  var manual = st.mode === 'manual';

  /* 滑条显示值 */
  if (now - drag.thr > 300 && veh) {
    var tv = Math.round((veh.throttle || 0) * 100);
    $.slThr.__inp.value = tv;
    setText($.slThr.__val, tv + '%');
  }
  if (now - drag.pitch > 300 && veh) {
    var pv = Math.round(veh.pitch || 0);
    $.slPitch.__inp.value = pv;
    setText($.slPitch.__val, pv + '°');
  }
  /* 偏航/滚转杆为瞬时控件，不回写 */
  $.slThr.__inp.disabled = !manual;
  $.slPitch.__inp.disabled = !manual;
  $.slYaw.__inp.disabled = !manual;
  $.slRoll.__inp.disabled = !manual;

  /* 按钮 */
  setText($.btnEng, veh && veh.engines ? '引擎关机 (E)' : '引擎点火 (E)');
  $.btnFins.classList.toggle('active', !!(veh && veh.fins));
  $.btnSep.disabled = !manual || st.active !== 'stack';
  setText($.btnSwitch, '切换载具 (TAB) 当前:' + String(st.active || '').toUpperCase());
  setText($.btnAssist, 'RCS 辅助 ' + (st.assist ? '开' : '关'));
  $.btnAssist.classList.toggle('active', !!st.assist);
  [$.btnEng, $.btnFins, $.btnFlip, $.btnSwitch].forEach(function (b) { b.disabled = !manual; });

  /* 任务参数行（脚本模式+运行中锁定；自适应实时可调） */
  var lockParams = (st.paramMode === 'script' && st.running);
  for (var pk in $.dpRows) {
    var pr = $.dpRows[pk];
    var pv = st.params ? st.params[pk] : pendingParams[pk];
    if (document.activeElement !== pr.inp) pr.set(pv);
    if (pr.inp) pr.inp.disabled = lockParams;
    if (pr.btns) pr.btns.forEach(function (b) { b.disabled = lockParams; });
  }
  $.dpModeScript.classList.toggle('active', st.paramMode === 'script');
  $.dpModeAdaptive.classList.toggle('active', st.paramMode === 'adaptive');
  setText($.dpModeScript, lockParams ? '脚本模式（已锁定）' : '脚本模式');
}

/* ============================================================
   UI.showEnd(state) — 结局弹窗
   ============================================================ */
function showEnd(st) {
  if (!root || endVisible) return;
  state = st;
  endVisible = true;
  closeDrawer();
  var out = st.outcome || 'fail';
  $.endCard.classList.remove('fail', 'success', 'partial');
  $.endCard.classList.add(out);
  if (out === 'fail') {
    setText($.endTitle, '任务失败');
    setText($.endNote, st.failReason || '');
  } else if (out === 'partial') {
    setText($.endTitle, '部分成功');
    setText($.endNote, st.endingNote || '部分任务目标未达成');
  } else {
    setText($.endTitle, '任务成功');
    setText($.endNote, st.endingNote || '全部任务目标达成');
  }
  setText($.statEls.time, fmtClock(st.simTime));
  setText($.statEls.alt, (Math.max(0, (st.stats.maxAlt || 0) / 1000)).toFixed(1));
  setText($.statEls.spd, String(Math.round((st.stats.maxSpeed || 0) * 3.6)));
  setText($.statEls.g, (st.stats.maxG || 0).toFixed(1));
  $.end.classList.remove('hidden');
  root.classList.add('end-open');
}

/* ---------------- 导出全局 UI ---------------- */
window.UI = {
  init: init,
  update: update,
  showEnd: showEnd,
  toast: pushToast          // 附加能力：内部/调试用 toast
};

})();
