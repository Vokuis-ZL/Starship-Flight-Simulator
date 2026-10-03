/* ============================================================
 * PHYS — 星舰 IFT-14 全任务仿真 物理与自动驾驶模块 v2
 * 新增：真实任务时钟、脚本/自适应双模式、参数化引擎、时间线事件
 * 挂载全局 PHYS，普通脚本无依赖（可选用 MISSION14）
 * ============================================================ */
var PHYS = (function () {
  'use strict';
  var G0 = 9.81;

  /* ---------- 基准规格（每台引擎） ---------- */
  var ENG = {
    booster: { dry: 200e3, propBase: 3800e3, fPer: 75e6 / 33, isp: 327, area: 64 },
    ship: { dry: 120e3, propBase: 1200e3, fPer: 14.4e6 / 6, isp: 365, area: 64 }
  };
  var TOWER_X = 0;            // 发射塔/捕获点
  var PLATFORM_X = 80000;     // 美洲湾溅落区（自然弹道落点）

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rhoAt(h) { return 1.225 * Math.exp(-Math.max(0, h) / 8500); }
  function deg2rad(d) { return d * Math.PI / 180; }
  function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (var i = 1; i < table.length; i++) {
      if (x <= table[i][0]) {
        var a = table[i - 1], b = table[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return table[table.length - 1][1];
  }

  /* 程序俯仰表（stack，高度 m → pitch°，0=垂直向上） */
  var PITCH_STACK = [[0, 0], [800, 2], [2000, 7], [5000, 16], [9000, 26], [15000, 36], [25000, 48], [35000, 60], [45000, 72], [55000, 78], [68000, 82]];
  /* ship 垂直速度闭环导引剖面 */
  var VY_SHIP = [[0, 320], [60000, 260], [90000, 190], [110000, 110], [130000, 30]];

  /* ---------- 默认参数 ---------- */
  function defParams() {
    if (typeof MISSION14 !== 'undefined') return MISSION14.defaultParams();
    return { boosterEngines: 33, shipEngines: 6, thrustScale: 1.0, fuelScale: 1.0, sepAlt: 62, recovery: 0 };
  }

  /* ---------- 状态 ---------- */
  var S = null;
  var input = { pitch: 0, yaw: 0, roll: 0 };

  function specOf(v) { return ENG[v.kind === 'ship' ? 'ship' : 'booster']; }
  function engFrac(v) { return v._engFrac || 1; }
  function maxF(v) {
    var n = (v.kind === 'ship') ? S.params.shipEngines : S.params.boosterEngines;
    return specOf(v).fPer * n * S.params.thrustScale * engFrac(v);
  }
  function fuelMaxOf(v) {
    return ((v.kind === 'ship') ? ENG.ship.propBase : ENG.booster.propBase) * S.params.fuelScale;
  }
  function massOf(v) {
    if (v.kind === 'stack') return 320e3 + v.fuel + v.shipFuel;
    return specOf(v).dry + v.fuel;
  }
  function dragCoef(v) {
    if (v.kind === 'ship') {
      var belly = Math.abs(Math.abs(v.pitch) - 90) < 30;
      return belly ? (v.flaps ? 1.9 : 1.5) : 0.8;
    }
    return v.fins ? 1.2 : 0.55;
  }

  function makeStack() {
    return {
      kind: 'stack', x: 0, y: 0, vx: 0, vy: 0, pitch: 0, yaw: 0, roll: 0,
      throttle: 0, engines: false,
      fuel: ENG.booster.propBase * S.params.fuelScale, fuelMax: ENG.booster.propBase * S.params.fuelScale,
      shipFuel: ENG.ship.propBase * S.params.fuelScale, shipFuelMax: ENG.ship.propBase * S.params.fuelScale,
      alive: true, landed: false, caught: false, crashed: false, splashed: false,
      fins: false, flaps: false, heat: 0, q: 0, gload: 0,
      phase: 'COUNTDOWN', tPhase: 0, autoFlip: false, _engFrac: 1
    };
  }
  function makeBooster(src) {
    return {
      kind: 'booster', x: src.x, y: src.y, vx: src.vx, vy: src.vy, pitch: src.pitch, yaw: 0, roll: 0,
      throttle: 0, engines: false, fuel: src.fuel, fuelMax: src.fuelMax,
      alive: true, landed: false, caught: false, crashed: false, splashed: false,
      fins: false, flaps: false, heat: 0, q: 0, gload: 0,
      phase: 'BCOAST', tPhase: 0, autoFlip: false, _engFrac: 1
    };
  }
  function makeShip(src) {
    return {
      kind: 'ship', x: src.x, y: src.y, vx: src.vx, vy: src.vy, pitch: src.pitch, yaw: 0, roll: 0,
      throttle: 0, engines: false, fuel: src.shipFuel, fuelMax: src.shipFuelMax,
      alive: true, landed: false, caught: false, crashed: false, splashed: false,
      fins: false, flaps: false, heat: 0, q: 0, gload: 0,
      phase: 'SASCENT', tPhase: 0, autoFlip: false, _engFrac: 1
    };
  }

  function pushEvent(text) {
    S.events.push({ text: text, t: S.simTime });
    if (S.events.length > 6) S.events.shift();
  }
  function pushToast(text) { S.toasts.push({ text: text, t: S.simTime }); }
  function mark(id) {
    if (S.timelineDone[id]) return;
    S.timelineDone[id] = true;
    if (typeof MISSION14 !== 'undefined') {
      var TL = MISSION14.TIMELINE;
      for (var i = 0; i < TL.length; i++) {
        if (TL[i].id === id) { pushEvent(TL[i].name); break; }
      }
    }
  }

  /* ---------- 初始化 ---------- */
  function init(cfg) {
    cfg = cfg || {};
    var params = cfg.params || defParams();
    S = {
      simTime: -17, running: true, paused: false,
      mode: cfg.mode || 'auto',
      timeMode: cfg.timeMode || 'compressed',
      userSpeed: 1,
      realspeed: false,
      assist: true,
      paramMode: cfg.paramMode || 'script',
      params: params,
      recovery: (params.recovery === 1) ? 'tower' : 'sea',
      active: 'stack',
      vehicles: {},
      events: [], toasts: [],
      stats: { maxAlt: 0, maxSpeed: 0, maxG: 0 },
      phases: {},
      missionOver: false, outcome: null, failReason: '', endingNote: '',
      platformX: (params.recovery === 1) ? TOWER_X : PLATFORM_X,
      timelineDone: {}, _tlIdx: 0,
      _maxqDone: false, _orbitDone: false, _flipDone: false, _sepDone: false,
      _coastOn: false, _engOffEvt: false, _ftsDone: false, _fuelWarned: {}
    };
    S.vehicles.stack = makeStack();
    return S;
  }
  function restart() {
    init({ mode: S.mode, timeMode: S.timeMode, params: S.params, paramMode: S.paramMode });
  }
  function getState() { return S; }

  /* ---------- 指令 ---------- */
  function activeVeh() { return S.vehicles[S.active] || null; }
  function isManual(v) { return S.mode === 'manual' && S.active === vehKey(v); }
  function vehKey(v) {
    for (var k in S.vehicles) if (S.vehicles[k] === v) return k;
    return 'stack';
  }
  function switchVeh() {
    if (S.mode !== 'manual') return;
    if (S.vehicles.booster && S.vehicles.ship) {
      S.active = (S.active === 'booster') ? 'ship' : 'booster';
      pushEvent('切换控制：' + (S.active === 'booster' ? '超重型助推器' : '星舰飞船'));
    }
  }
  function cmd(c) {
    if (!S) return;
    var v = activeVeh();
    switch (c.type) {
      case 'throttle':
        if (v && isManual(v)) { v.throttle = clamp(c.v, 0, 1); if (v.throttle > 0.02) v.engines = true; }
        break;
      case 'pitch':
        if (v && isManual(v)) v.pitch = clamp(c.v, -180, 180);
        break;
      case 'engines':
        if (v && isManual(v)) v.engines = !v.engines;
        break;
      case 'fins':
        if (v && isManual(v)) v.fins = !v.fins;
        break;
      case 'flip':
        if (v && isManual(v)) { v.autoFlip = true; pushEvent('着陆翻转程序启动'); }
        break;
      case 'sep':
        if (v && v.kind === 'stack' && (v.phase === 'MECO' || v.phase === 'HOTSTAGE' || (v.y > 35000 && v.fuel < v.fuelMax * 0.4))) doSeparation();
        break;
      case 'assist': S.assist = !S.assist; break;
      case 'mode':
        S.mode = (S.mode === 'auto') ? 'manual' : 'auto';
        pushEvent(S.mode === 'auto' ? '自动驾驶已接管' : '切换手动驾驶');
        break;
      case 'speed': S.userSpeed = c.v || 1; break;
      case 'realspeed':
        S.realspeed = !S.realspeed;
        pushEvent(S.realspeed ? '真实时间播放（1×）' : '智能压缩播放');
        break;
      case 'switch': switchVeh(); break;
      case 'pause': S.paused = !S.paused; break;
      case 'param':
        if (S.paramMode === 'script' && S.running) return;    // 发射前锁定
        applyParam(c.key, c.value);
        break;
      case 'paramMode':
        S.paramMode = (c.value === 'adaptive') ? 'adaptive' : 'script';
        pushEvent(S.paramMode === 'adaptive' ? '自适应模式：参数实时生效' : '脚本模式：真实任务时间线');
        break;
    }
  }
  function applyParam(key, value) {
    if (!(key in S.params)) return;
    S.params[key] = value;
    if (key === 'recovery') {
      S.recovery = (value === 1) ? 'tower' : 'sea';
      S.platformX = (value === 1) ? TOWER_X : PLATFORM_X;
    }
    if (key === 'fuelScale') {
      var r = value / (S._lastFuelScale || 1);
      S._lastFuelScale = value;
      for (var k in S.vehicles) {
        var v = S.vehicles[k];
        v.fuel = clamp(v.fuel * r, 0, fuelMaxOf(v));
        v.fuelMax = fuelMaxOf(v);
        if (v.kind === 'stack') { v.shipFuel = clamp(v.shipFuel * r, 0, ENG.ship.propBase * S.params.fuelScale); v.shipFuelMax = ENG.ship.propBase * S.params.fuelScale; }
      }
    }
  }
  function setInput(k, v) { input[k] = clamp(v, -1, 1); }

  /* ---------- 分离 ---------- */
  function doSeparation() {
    var st = S.vehicles.stack;
    if (!st || S._sepDone) return;
    S._sepDone = true;
    st.engines = false; st.throttle = 0;
    var booster = makeBooster(st);
    booster.phase = (S.paramMode === 'script') ? 'BOOSTBACK' : (S.recovery === 'sea' ? 'BCOAST' : 'BOOSTBACK');
    var ship = makeShip(st);
    ship.engines = true; ship.throttle = 0.8;
    ship._engFrac = (S.paramMode === 'script') ? 5 / 6 : 1;   // 脚本：一台真空猛禽提前关机
    ship.phase = 'SASCENT';
    ship.vy += Math.cos(deg2rad(st.pitch)) * 2.5;
    ship.vx += Math.sin(deg2rad(st.pitch)) * 2.5;
    delete S.vehicles.stack;
    S.vehicles.booster = booster;
    S.vehicles.ship = ship;
    S.active = 'ship';
    pushEvent('热级分离');
  }

  /* ---------- 时间倍率（任务时钟压缩剖面） ---------- */
  function effSpeed() {
    if (!S) return 1;
    if (S.realspeed) return S.userSpeed;
    var rate = 2;
    if (typeof MISSION14 !== 'undefined') rate = MISSION14.rateAt(S.simTime);
    return rate * S.userSpeed;
  }

  /* ---------- 脚本时间线推进 ---------- */
  function timelineStep() {
    if (typeof MISSION14 === 'undefined') return;
    var TL = MISSION14.TIMELINE;
    while (S._tlIdx < TL.length && TL[S._tlIdx].t <= S.simTime) {
      var node = TL[S._tlIdx];
      S._tlIdx++;
      mark(node.id);
      timelineAction(node.id);
    }
  }
  function timelineAction(id) {
    if (S.paramMode !== 'script') {
      /* 自适应：仅通用动作（点火/相位标签），其余由条件机触发 */
      if (id === 'IGNITION') {
        var st0 = S.vehicles.stack;
        if (st0) { st0.engines = true; st0.throttle = 1; }
      } else if (id === 'LIFTOFF') {
        var st1 = S.vehicles.stack;
        if (st1 && st1.engines) { st1.phase = 'LIFTOFF'; st1.tPhase = 0; }
      } else if (id === 'ORBIT') {
        S._orbitDone = true;
      } else if (id === 'SPLASH' && S.vehicles.ship && S.vehicles.ship.alive && !S.vehicles.ship.landed) {
        forceShipSplash();
      }
      return;
    }
    var st = S.vehicles.stack, b = S.vehicles.booster, sh = S.vehicles.ship;
    switch (id) {
      case 'IGNITION':
        if (st) { st.engines = true; st.throttle = 1; }
        break;
      case 'LIFTOFF':
        if (st && st.engines) { st.phase = 'LIFTOFF'; st.tPhase = 0; }
        break;
      case 'MAXQ': S._maxqDone = true; break;
      case 'MECO':
        if (st) { st.phase = 'MECO'; st.tPhase = 0; st.engines = false; st.throttle = 0; }
        break;
      case 'HOTSTAGE':
        if (st) doSeparation();
        break;
      case 'BOOSTBACK':
        if (b) { b.phase = 'BOOSTBACK'; b.tPhase = 0; b.engines = true; b._engFrac = 31 / 33; }
        break;
      case 'BOOSTBACK_END':
        if (b) { b.engines = false; b.throttle = 0; b._engFrac = 1; b.phase = 'BCOAST'; b.tPhase = 0; }
        break;
      case 'BLAND':
        if (b && !b.landed) { b.phase = 'BLANDING'; b.tPhase = 0; b.engines = true; b._engFrac = 11 / 33; }
        break;
      case 'BSPLASH':
        if (b && !b.landed && !b.crashed) {
          b.landed = true; b.splashed = true; b.alive = true;
          b.y = 0; b.vy = 0; b.vx = 0; b.throttle = 0; b.engines = false;
          b.phase = 'RECOVERED';
        }
        break;
      case 'SECO1':
        if (sh) { sh.phase = 'COAST'; sh.tPhase = 0; sh.engines = false; sh.throttle = 0; S._coastOn = true; }
        break;
      case 'OIB':
        if (sh) { sh.phase = 'OIB'; sh.tPhase = 0; sh.engines = true; sh.throttle = 1; sh._engFrac = 1 / 6; }
        break;
      case 'ORBIT':
        if (sh) { sh.engines = false; sh.throttle = 0; sh.phase = 'ORBIT'; sh.tPhase = 0; sh._engFrac = 1; S._orbitDone = true; }
        break;
      case 'DEORBIT':
        if (sh) { sh.phase = 'DEORBIT'; sh.tPhase = 0; sh.engines = true; sh.throttle = 1; sh._engFrac = 1 / 6; }
        break;
      case 'DEORBIT_END':
        if (sh) { sh.engines = false; sh.throttle = 0; sh.phase = 'DESCENT'; sh.tPhase = 0; S._coastOn = false; }
        break;
      case 'ENTRY':
        if (sh && !sh.landed) { sh.phase = 'REENTRY'; sh.tPhase = 0; }
        break;
      case 'SLAND':
        if (sh && !sh.landed) { sh.phase = 'SLANDING'; sh.tPhase = 0; sh.engines = true; sh._engFrac = 3 / 6; }
        break;
      case 'FLIP':
        if (sh) { sh.autoFlip = true; S._flipDone = true; }
        break;
      case 'SPLASH':
        if (sh && !sh.landed && !sh.crashed) forceShipSplash();
        break;
    }
  }
  function forceShipSplash() {
    var sh = S.vehicles.ship;
    if (!sh) return;
    sh.landed = true; sh.splashed = true; sh.alive = true;
    sh.y = 0; sh.vy = 0; sh.vx = 0; sh.throttle = 0; sh.engines = false;
    sh.phase = 'RECOVERED';
    endMission(boosterRecovered() ? 'success' : 'partial');
  }

  /* ---------- 载具物理 ---------- */
  function stepVeh(v, h) {
    if (!v.alive || v.landed || v.crashed) return;
    /* 未离地钳制 */
    if (!v._hasFlown) {
      if (v.y > 10) v._hasFlown = true;
      else {
        v.y = 0; v.vy = Math.max(0, v.vy); v.vx = 0;
        if (!(v.engines && v.throttle > 0.05)) return;
        if (maxF(v) * v.throttle <= massOf(v) * G0) return;
      }
    }
    var m = massOf(v);
    var rho = rhoAt(v.y);
    var vv = Math.hypot(v.vx, v.vy);

    /* 推力与燃料 */
    var F = 0, mdot = 0;
    if (v.engines && v.fuel > 0 && v.throttle > 0.01) {
      F = maxF(v) * v.throttle;
      mdot = F / (specOf(v).isp * G0);
      v.fuel = Math.max(0, v.fuel - mdot * h);
    }
    var pr = deg2rad(v.pitch);
    var axT = F * Math.sin(pr) / m;
    var ayT = F * Math.cos(pr) / m;

    /* 阻力（在轨滑行魔法窗口内为零） */
    var coast = (v.kind === 'ship') && S._coastOn && !isManual(v);
    var Fd = coast ? 0 : 0.5 * rho * vv * vv * specOf(v).area * dragCoef(v);
    var axD = 0, ayD = 0;
    if (!coast && vv > 0.5) { axD = -Fd * v.vx / vv / m; ayD = -Fd * v.vy / vv / m; }

    /* RCS 归位辅助 */
    var axR = rcsAssist(v);

    /* 手动持续输入 */
    if (isManual(v)) {
      v.pitch += input.pitch * 12 * h;
      v.yaw += input.yaw * 8 * h;
      v.roll += input.roll * 25 * h;
      if (v.autoFlip) {
        var dpf = (0 - v.pitch);
        v.pitch += clamp(dpf, -20 * h, 20 * h);
        if (Math.abs(dpf) < 1) v.autoFlip = false;
      }
    }

    var ax = axT + axD + axR;
    var ay = ayT + ayD - (coast ? 0 : G0);

    v.vx += ax * h; v.vy += ay * h;
    v.x += v.vx * h; v.y += v.vy * h;

    var gload = Math.hypot(axT + axD, ayT + ayD) / G0;
    v.q = coast ? 0 : 0.5 * rho * vv * vv;
    if (v.vy < 0 && v.y < 100e3 && vv > 300 && !coast) {
      var belly = (v.kind === 'ship' && Math.abs(Math.abs(v.pitch) - 90) < 30) ? 0.5 : 1;
      v.heat = Math.sqrt(rho) * vv * vv * vv * 0.45e-9 * belly;
    } else v.heat = Math.max(0, v.heat - 0.05);

    v.gload = gload;
    S.stats.maxAlt = Math.max(S.stats.maxAlt, v.y);
    S.stats.maxSpeed = Math.max(S.stats.maxSpeed, vv);
    S.stats.maxG = Math.max(S.stats.maxG, gload);
  }

  function rcsAssist(v) {
    var tx, maxY, div;
    if (v.kind === 'ship') {
      if (!(v.vy < 0 && v.y < 110e3 && (v.phase === 'REENTRY' || v.phase === 'FLIP' || v.phase === 'SLANDING'))) return 0;
      tx = v._landX || TOWER_X; maxY = 10; div = 40;
    } else if (v.kind === 'booster') {
      if (!(v.y < 60e3 && v.vy < 0)) return 0;
      tx = S.platformX;
      maxY = (v.y < 12e3) ? 16 : 10;
      div = (v.y < 5e3) ? 8 : ((v.y < 12e3) ? 15 : 40);
    } else return 0;
    var desiredVx = clamp((tx - v.x) / div, -700, 700);
    return clamp((desiredVx - v.vx) * 0.5, -maxY, maxY);
  }

  function seekPitch(v, target, rate, h) {
    var dp = target - v.pitch;
    v.pitch += clamp(dp, -rate * h, rate * h);
    return Math.abs(dp);
  }
  function capThrottle(v, base, gCap) {
    var cap = gCap * G0 * massOf(v) / Math.max(1, maxF(v));
    return clamp(Math.min(base, cap), 0, 1);
  }

  /* ---------- 自动驾驶 ---------- */
  function autopilot(v, h) {
    var script = (S.paramMode === 'script');
    var tx = S.platformX;
    switch (v.kind) {
      case 'stack':
        if (v.engines) {
          var thr = 1;
          if (v.q > 22000) thr = 0.72;
          v.throttle = capThrottle(v, thr, 4.6);
          seekPitch(v, interp(PITCH_STACK, v.y), 8, h);
        } else v.throttle = 0;
        break;
      case 'booster':
        if (script) {
          switch (v.phase) {
            case 'BOOSTBACK':
              v.engines = true;
              v.throttle = capThrottle(v, 0.25, 5.0);   /* 耗尽式返推：31台低油门 */
              seekPitch(v, (v.vx > -100) ? -100 : -80, 20, h);
              break;
            case 'BCOAST':
              v.engines = false; v.throttle = 0;
              if (v.y < 60e3) v.fins = true;
              seekPitch(v, 0, 8, h);
              if (v.vy < 0 && v.y < 28000) { v.phase = 'BLANDING'; v.tPhase = 0; pushEvent('助推器着陆点火'); }
              break;
            case 'BLANDING': {
              v.engines = true;
              /* 逐级减推力：11→5→3 台（真实 IFT-14） */
              if (S.simTime >= 412) v._engFrac = 3 / 33;
              else if (S.simTime >= 405) v._engFrac = 5 / 33;
              else v._engFrac = 11 / 33;
              var vyT = -clamp(Math.sqrt(Math.max(0, v.y - 2)) * 0.62, 2, 80);
              var aCmd = G0 + (vyT - v.vy) * 0.6;
              v.throttle = capThrottle(v, clamp(aCmd * massOf(v) / Math.max(1, maxF(v)), 0, 1), 3.5);
              seekPitch(v, 0, 10, h);
              break;
            }
          }
        } else {
          switch (v.phase) {
            case 'BOOSTBACK': {
              var tFall = Math.sqrt(2 * Math.max(v.y, 60e3) / G0) + 30;
              var vxT = clamp((tx - v.x) / tFall, -1600, -300);
              v.engines = true;
              v.throttle = capThrottle(v, 0.393, 5.0);
              seekPitch(v, (v.vx > vxT) ? -100 : -80, 20, h);
              if (v.vx <= vxT + 40 || v.tPhase > 60) { v.engines = false; v.throttle = 0; v.phase = 'BCOAST'; v.tPhase = 0; }
              break;
            }
            case 'BCOAST': {
              v.engines = false; v.throttle = 0;
              if (v.y < 60e3) v.fins = true;
              seekPitch(v, clamp((tx - v.x) / 1500, -12, 12), 8, h);
              var rhoC = Math.max(rhoAt(v.y), 1e-7);
              var termC = Math.sqrt(2 * massOf(v) * G0 / (rhoC * 1.2 * 64));
              var vvC = Math.hypot(v.vx, v.vy);
              if (v.vy < 0 && v.y < 55e3 && (vvC > termC * 1.08 || vvC > 1300)) { v.phase = 'BENTRY'; v.tPhase = 0; }
              if (v.vy < 0 && v.y < 4000) { v.phase = 'BLANDING'; v.tPhase = 0; }
              break;
            }
            case 'BENTRY': {
              var vv = Math.hypot(v.vx, v.vy);
              var term = Math.sqrt(2 * massOf(v) * G0 / (Math.max(rhoAt(v.y), 1e-7) * 1.2 * 64));
              var vT = Math.min(term * 0.95, Math.sqrt(2 * 45000 / Math.max(rhoAt(v.y), 1e-7)));
              var burn = (vv > vT) && (v.vy < -30);
              v.engines = burn;
              v.throttle = capThrottle(v, burn ? ((S.recovery === 'sea') ? 0.85 : 0.393) : 0, 5.0);
              seekPitch(v, clamp((tx - v.x) / 1500, -12, 12), 10, h);
              if (v.y < 4000) { v.engines = false; v.throttle = 0; v.phase = 'BLANDING'; v.tPhase = 0; }
              break;
            }
            case 'BLANDING': {
              v.engines = true;
              var vyT2 = -clamp(Math.sqrt(Math.max(0, v.y - 2)) * 0.62, 2, 80);
              var aCmd2 = G0 + (vyT2 - v.vy) * 0.6;
              v.throttle = capThrottle(v, clamp(aCmd2 * massOf(v) / Math.max(1, maxF(v)), 0, 1), 3.5);
              seekPitch(v, clamp((tx - v.x) / 800, -15, 15), 10, h);
              break;
            }
          }
        }
        break;
      case 'ship':
        switch (v.phase) {
          case 'SASCENT': {
            /* 垂直速度闭环导引 */
            var aMax = maxF(v) / massOf(v);
            var vyT3 = interp(VY_SHIP, v.y);
            var kd = clamp((v.vy - vyT3) * 0.012, 0, 6);
            var cosP = clamp((G0 - kd) / aMax, 0.03, 0.999);
            seekPitch(v, Math.acos(cosP) * 180 / Math.PI, 8, h);
            v.engines = true;
            v.throttle = capThrottle(v, 1, 4.2);
            break;
          }
          case 'COAST': case 'ORBIT':
            v.engines = false; v.throttle = 0;
            break;
          case 'OIB':
            v.engines = true; v.throttle = 1;
            seekPitch(v, 88, 10, h);   /* 顺行水平入轨点火 */
            break;
          case 'DEORBIT':
            v.engines = true; v.throttle = (script ? 1 : 0.4);
            seekPitch(v, Math.atan2(-v.vx, -v.vy) * 180 / Math.PI, 25, h);
            break;
          case 'DESCENT':
            v.engines = false; v.throttle = 0;
            seekPitch(v, 90, 8, h);
            break;
          case 'REENTRY':
            v.engines = false; v.throttle = 0;
            if (v.y < 75e3) v.flaps = true;
            if (!v._landX && v.y < 60e3) { v._landX = v.x + v.vx * 45; pushEvent('溅落区已确认'); }
            if (v.y < 30e3) v._landX = v.x + v.vx * 40;
            seekPitch(v, 90, 15, h);
            break;
          case 'FLIP':
            if (v.y < 75e3) v.flaps = true;
            seekPitch(v, 0, 25, h);
            break;
          case 'SLANDING': {
            v.engines = true;
            var vyT4 = clamp(-Math.sqrt(Math.max(0, v.y - 2)) * 1.0, -140, -4);
            var aCmd3 = G0 + (vyT4 - v.vy) * 0.8;
            v.throttle = capThrottle(v, clamp(aCmd3 * massOf(v) / Math.max(1, maxF(v)), 0, 1), 4.2);
            break;
          }
        }
        break;
    }
  }

  /* ---------- 阶段机（自适应模式的条件推进） ---------- */
  function phaseLogic(v, h) {
    v.tPhase += h;
    var adaptive = (S.paramMode === 'adaptive');
    /* 飞船下降段 transitions：两种模式通用（高度触发，时间线节点兜底） */
    if (v.kind === 'ship') {
      if (v.phase === 'REENTRY' && v.y < 3000) {
        v.phase = 'FLIP'; v.tPhase = 0; S._flipDone = true; pushEvent('着陆翻转');
      } else if (v.phase === 'FLIP' && Math.abs(v.pitch) < 25 && v.y < 2300) {
        v.phase = 'SLANDING'; v.tPhase = 0;
      }
    }
    if (v.kind === 'stack' && adaptive) {
      switch (v.phase) {
        case 'COUNTDOWN':
          if (S.simTime >= 0 && v.engines) { v.phase = 'LIFTOFF'; v.tPhase = 0; pushEvent('点火升空'); }
          break;
        case 'LIFTOFF':
          if (v.y > 800) { v.phase = 'PITCH_KICK'; v.tPhase = 0; }
          break;
        case 'PITCH_KICK':
          if (v.q > 22000) { v.phase = 'MAX-Q'; v.tPhase = 0; S._maxqDone = true; }
          break;
        case 'MAX-Q':
          if (v.q < 20000) { v.phase = 'ASCENT'; v.tPhase = 0; }
          break;
        case 'ASCENT':
          if (v.fuel <= v.fuelMax * 0.25 || v.y > S.params.sepAlt * 1000) {
            v.phase = 'MECO'; v.tPhase = 0; v.engines = false; v.throttle = 0;
            pushEvent('MECO 主引擎关机');
          }
          break;
        case 'MECO':
          if (v.tPhase > 2.5 && !isManual(v)) doSeparation();
          break;
      }
    }
    if (v.kind === 'ship' && adaptive) {
      switch (v.phase) {
        case 'SASCENT': {
          var vv = Math.hypot(v.vx, v.vy);
          var nominal = (vv >= 7350 && v.y >= 95000);
          var fuelGuard = (v.fuel <= v.fuelMax * 0.07 && vv >= 7050 && v.y >= 90000);   // 燃料感知：保带着陆储备
          if (nominal || fuelGuard) {
            v.phase = 'ORBIT'; v.tPhase = 0;
            v.engines = false; v.throttle = 0;
            S._coastOn = true;
            pushEvent('SECO — 进入亚轨道');
          }
          break;
        }
        case 'ORBIT':
          if (v.tPhase > 20 && !S._orbitDone) { v.phase = 'OIB'; v.tPhase = 0; v._engFrac = 1 / 6; pushEvent('入轨点火'); }
          else if (v.tPhase > 25 && S._orbitDone) { v.phase = 'DEORBIT'; v.tPhase = 0; pushEvent('离轨点火'); }
          break;
        case 'OIB':
          if (v.tPhase > 19) {
            v.engines = false; v.throttle = 0; v._engFrac = 1;
            v.phase = 'ORBIT'; v.tPhase = 0;
            S._orbitDone = true;
            pushEvent('入轨成功');
          }
          break;
        case 'DEORBIT':
          if (v.tPhase > 8) {
            v.engines = false; v.throttle = 0; v._engFrac = 1;
            v.phase = 'DESCENT'; v.tPhase = 0;
            S._coastOn = false;
            pushEvent('离轨完成');
          }
          break;
        case 'DESCENT':
          if (v.y <= 100.5e3) { v.phase = 'REENTRY'; v.tPhase = 0; pushEvent('再入大气层'); }
          break;
        case 'REENTRY':
          if (v.y < 3000) { v.phase = 'FLIP'; v.tPhase = 0; S._flipDone = true; pushEvent('着陆翻转'); }
          break;
        case 'FLIP':
          if (Math.abs(v.pitch) < 25 && v.y < 2300) { v.phase = 'SLANDING'; v.tPhase = 0; }
          break;
      }
    }
    if (v.kind === 'booster' && adaptive) {
      switch (v.phase) {
        case 'BCOAST':
          if (v.vy < 0 && v.y < 55e3) { v.phase = 'BENTRY'; v.tPhase = 0; pushEvent('助推器再入点火'); }
          break;
      }
    }
  }

  /* ---------- 滑行/下降魔法导引（物理外的轨道托举） ---------- */
  function coastGuidance(v, h) {
    if (v.kind !== 'ship' || !S._coastOn) return;
    var yT = S._orbitDone ? 275e3 : 155e3;
    var vyWanted = clamp((yT - v.y) * 0.004, -80, 80);
    v.vy += clamp(vyWanted - v.vy, -30 * h, 30 * h);
    if (v.phase === 'COAST' || v.phase === 'ORBIT') {
      v.pitch += clamp(88 - v.pitch, -3 * h, 3 * h);
    }
  }
  function descentGuidance(v, h) {
    if (v.kind !== 'ship' || v.phase !== 'DESCENT') return;
    var tRem = Math.max(40, 34132 - S.simTime);
    var vyW = -(v.y - 100e3) / tRem;
    if (S.paramMode === 'adaptive') vyW = -(v.y - 100e3) / 240;
    v.vy = clamp(vyW, -140, -12);
    if (v.vx < 6000) v.vx = 6000;
  }

  /* ---------- 失败检测与接地 ---------- */
  function checks(v) {
    if (!v.alive || v.landed || !v._hasFlown) return;
    var vv = Math.hypot(v.vx, v.vy);
    var qLim = (v.kind === 'ship')
      ? ((v.phase === 'REENTRY' || v.phase === 'FLIP' || v.phase === 'SLANDING' || v.phase === 'DESCENT') ? 1e9 : 110000)
      : ((S.recovery === 'sea') ? 160000 : 110000);
    if (v.q > qLim) return fail(v, '结构解体：最大动压超限');
    var gLim = (v.kind === 'ship') ? 20.0 : 6.5;
    if (v.gload > gLim) return fail(v, '结构过载：' + v.gload.toFixed(1) + 'g 超限');
    var heatLim = (v.kind === 'ship') ? 5.5 : 4.2;
    if (v.heat > heatLim) return fail(v, v.kind === 'ship' ? '再入烧毁：热流超限，再入角度过陡或姿态错误' : '助推器烧毁：缺少减速措施');
    var tx = (v.kind === 'ship') ? (v._landX || TOWER_X) : S.platformX;
    if (v.y <= 0 && v.vy < 0) {
      var water = (v.kind === 'booster' && S.recovery === 'sea') || v.kind === 'ship';   // IFT-14 双溅落
      var softV = water ? 30 : 10;
      var soft = (v.vy > -softV) && (Math.abs(v.vx) < (water ? 40 : 8)) && (Math.abs(v.pitch) < 45);
      var near = Math.abs(v.x - tx) < ((v.kind === 'ship') ? 800 : (water ? 60000 : 500));
      if (soft && near) {
        v.landed = true; v.y = 0; v.vx = 0; v.vy = 0; v.throttle = 0; v.engines = false;
        if (water) v.splashed = true;
        v.phase = 'RECOVERED';
        if (v.kind === 'ship') {
          pushEvent(v.splashed ? '星舰溅落成功' : '星舰着陆成功');
          endMission(boosterRecovered() ? 'success' : 'partial');
        } else {
          v.splashed = true;
          pushEvent('助推器溅落成功');
        }
      } else {
        fail(v, !near ? (v.kind === 'ship' ? '偏离着陆区坠毁' : '偏离回收点坠毁')
          : '接地速度过大（|vy|=' + Math.abs(v.vy).toFixed(0) + ' m/s）');
      }
      return;
    }
    /* 塔架捕获 */
    if (v.kind === 'booster' && v.y < 165 && Math.abs(v.x - TOWER_X) < 120 && Math.abs(v.vx) < 10 && v.vy > -10 && v.vy < 0 && S.recovery === 'tower') {
      v.caught = true; v.landed = true; v.alive = true;
      v.x = TOWER_X; v.y = 150; v.vx = 0; v.vy = 0;
      v.throttle = 0; v.engines = false; v.phase = 'RECOVERED';
      pushEvent('发射塔回收成功 — 机械臂已捕获');
    }
    var vk = vehKey(v);
    if (v.fuel <= 0 && v.engines && !S._fuelWarned[vk]) {
      S._fuelWarned[vk] = true;
      pushToast(v.kind === 'ship' ? '警告：飞船燃料耗尽' : '警告：助推器燃料耗尽');
    }
    if (v.kind !== 'ship' && v.x > 5e7) fail(v, '偏离任务空域');
  }
  function boosterRecovered() {
    var b = S.vehicles.booster;
    return !b || b.caught || b.landed;
  }
  function fail(v, reason) {
    if (v.crashed) return;
    v.crashed = true; v.alive = false;
    v.engines = false; v.throttle = 0;
    pushToast(v.kind === 'ship' ? '任务失败：' + reason : '助推器损失：' + reason);
    if (v.kind === 'ship') endMission('fail', reason);
    else S.endingNote = '（助推器损失：' + reason + '）';
  }
  function endMission(outcome, reason) {
    if (S.missionOver) return;
    S.missionOver = true;
    S.outcome = outcome;
    S.failReason = reason || '';
    S.running = false;
    if (outcome === 'success') S.endingNote = boosterRecovered() ? '' : (S.endingNote || '（助推器损失）');
  }

  /* ---------- 总推进 ---------- */
  function step(dtSim) {
    if (!S || S.paused || S.missionOver || !S.running) return;
    var n = Math.max(1, Math.ceil(dtSim / 0.05));
    var h = dtSim / n;
    for (var i = 0; i < n; i++) {
      S.simTime += h;
      timelineStep();
      if (S.missionOver) return;
      for (var k in S.vehicles) {
        var v = S.vehicles[k];
        var manual = isManual(v);
        if (!manual) autopilot(v, h);
        coastGuidance(v, h);
        descentGuidance(v, h);
        phaseLogic(v, h);
        stepVeh(v, h);
        checks(v);
      }
      if (!S._engOffEvt && S.simTime > 60 && S.vehicles.stack) {
        S._engOffEvt = true;
        S.vehicles.stack._engFrac = 32 / 33;
        pushToast('一台猛禽引擎故障关机（32/33）');
      }
      if (!S._ftsDone && S.simTime > 425 && S.vehicles.booster && S.vehicles.booster.splashed) {
        S._ftsDone = true;
        pushToast('FTS 飞行终止系统触发演示（安全硬件验证）');
      }
    }
    S.phases = {};
    for (var k2 in S.vehicles) S.phases[k2] = S.vehicles[k2].phase;
  }

  /* ---------- checklist ---------- */
  function checklist() {
    if (!S) return [];
    var ship = S.vehicles.ship, booster = S.vehicles.booster, stack = S.vehicles.stack;
    var d = S.timelineDone;
    function dn(id) { return !!d[id]; }
    return [
      { name: '点火', done: dn('IGNITION') || dn('LIFTOFF'), now: !!(stack && stack.phase === 'COUNTDOWN') },
      { name: '上升', done: dn('MAXQ') || dn('MECO'), now: !!(stack && (stack.phase === 'LIFTOFF' || stack.phase === 'PITCH_KICK' || stack.phase === 'MAX-Q' || stack.phase === 'ASCENT')) },
      { name: 'MAX-Q', done: dn('MAXQ'), now: !!(stack && stack.phase === 'MAX-Q') },
      { name: '热级分离', done: dn('HOTSTAGE') || dn('BOOSTBACK'), now: !!(stack && stack.phase === 'MECO') },
      { name: '助推器返程', done: dn('BSPLASH') || !!(booster && booster.landed), now: !!(booster && !booster.landed && !booster.crashed) },
      { name: '入轨', done: dn('ORBIT'), now: !!(ship && (ship.phase === 'SASCENT' || ship.phase === 'COAST' || ship.phase === 'OIB')) },
      { name: '再入', done: dn('ENTRY') || !!(ship && (ship.phase === 'REENTRY' || ship.phase === 'FLIP' || ship.phase === 'SLANDING' || ship.landed)), now: !!(ship && ship.phase === 'DESCENT') },
      { name: '着陆翻转', done: dn('FLIP') || S._flipDone, now: !!(ship && ship.phase === 'FLIP') },
      { name: '溅落/着陆', done: !!(ship && (ship.landed || ship.crashed)), now: !!(ship && ship.phase === 'SLANDING') }
    ];
  }

  return {
    init: init,
    step: step,
    effSpeed: effSpeed,
    cmd: cmd,
    setInput: setInput,
    restart: restart,
    checklist: checklist,
    getState: getState
  };
})();
if (typeof window !== 'undefined') window.PHYS = PHYS;
