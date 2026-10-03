/* ============================================================
 * MISSION14 — SpaceX Starship Flight 14 (IFT-14) 真实任务数据
 * 时间轴来源：SpaceX 官方任务时间线（2026-09-28 首次入轨任务）
 * 全局对象 MISSION14，普通脚本无依赖
 * ============================================================ */
var MISSION14 = (function () {
  'use strict';

  /* ---------- 真实任务时间线（T+ 秒） ---------- */
  var TIMELINE = [
    { t: -17,  id: 'COUNTDOWN',  name: '终倒计时',     desc: 'T-00:17 发射倒计时开始，T-00:03 33台猛禽3点火' },
    { t: -3,   id: 'IGNITION',   name: '点火',         desc: '33 台猛禽 3 引擎点火，推力约 7600 吨力' },
    { t: 0,    id: 'LIFTOFF',    name: '升空',         desc: 'T+00:00 星箭离开发射台，飞越美洲湾上空爬升' },
    { t: 58,   id: 'MAXQ',       name: 'MAX-Q',        desc: 'T+00:58 最大动压——箭体承受气动压力峰值时刻' },
    { t: 75,   id: 'SUPERSONIC', name: '超音速',       desc: 'T+01:15 速度突破 1 马赫，进入超音速飞行' },
    { t: 140,  id: 'MECO',       name: 'MECO',         desc: 'T+02:20 主引擎关机（本次飞行一台猛禽途中故障关机，实际 32 台）' },
    { t: 142,  id: 'HOTSTAGE',   name: '热级分离',     desc: 'T+02:22 热分离——星舰上级在助推器仍排气时点火推离' },
    { t: 147,  id: 'BOOSTBACK',  name: '返推点火',     desc: 'T+02:27 助推器定向翻转，31 台引擎返推点火——刻意耗尽主箱液氧以测试性能极限' },
    { t: 187,  id: 'BOOSTBACK_END', name: '返推关机',  desc: 'T+03:07 返推关机，助推器弹道滑行返回' },
    { t: 395,  id: 'BLAND',      name: '助推器着陆点火', desc: 'T+06:35 着陆点火：11 台→5 台→3 台逐级减推力' },
    { t: 421,  id: 'BSPLASH',    name: '助推器溅落',   desc: 'T+07:01 超重型溅落美洲湾；随后 FTS 飞行终止系统触发演示安全硬件' },
    { t: 491,  id: 'SECO1',      name: 'SECO-1',       desc: 'T+08:11 上级引擎关机——一台真空猛禽提前关机，其余 5 台延长燃烧，进入被动安全亚轨道' },
    { t: 1528, id: 'OIB',        name: '入轨点火',     desc: 'T+25:28 重新点燃 1 台海平面猛禽，执行历史首次星舰入轨点火' },
    { t: 1547, id: 'ORBIT',      name: '进入轨道',     desc: 'T+25:47 入轨成功——星舰首次环绕地球，轨道高度约 275km' },
    { t: 2058, id: 'DEPLOY',     name: '星链部署',     desc: 'T+34:18 开始部署 26 颗星链 V3 卫星（1Tbps/颗）' },
    { t: 3890, id: 'DEPLOY_END', name: '部署完成',     desc: 'T+01:04:50 全部 26 颗卫星部署完毕并建立激光链路' },
    { t: 31938, id: 'DEORBIT',   name: '离轨点火',     desc: 'T+08:52:18 绕地约 6 圈后，点燃 1 台猛禽执行史上首次星舰离轨点火' },
    { t: 31949, id: 'DEORBIT_END', name: '离轨完成',   desc: 'T+08:52:29 离轨点火结束，飞船脱离轨道飞向北太平洋溅落区' },
    { t: 34132, id: 'ENTRY',     name: '再入大气层',   desc: 'T+09:28:52 再入界面——以约 7.4km/s 进入大气层，腹部隔热瓦朝向气流' },
    { t: 35250, id: 'TRANSONIC', name: '跨音速',       desc: 'T+09:47:30 速度降至 1 马赫附近，进入跨音速区' },
    { t: 35287, id: 'SUBSONIC',  name: '亚音速',       desc: 'T+09:48:07 完全亚音速，襟翼控制姿态准备翻转' },
    { t: 35411, id: 'SLAND',     name: '着陆点火',     desc: 'T+09:50:11 重新点燃全部 3 台海平面猛禽' },
    { t: 35413, id: 'FLIP',      name: '着陆翻转',     desc: 'T+09:50:13 着陆翻转机动——由腹部朝下转为尾向下降' },
    { t: 35430, id: 'SPLASH',    name: '太平洋溅落',   desc: 'T+09:50:30 太平洋精准溅落——首次轨道任务圆满成功' }
  ];

  /* ---------- 智能压缩播放剖面 ----------
     每段：{ until: 任务时钟秒, rate: 压缩倍率（每真实秒播放多少任务秒） }
     全程约 10.5 分钟播完 9h50m 真实任务 */
  var PROFILE = [
    { until: 0,     rate: 1 },     // 倒计时 实时 17s
    { until: 140,   rate: 2.5 },   // 上升 56s
    { until: 421,   rate: 4 },     // 分离/返推/助推器溅落 70s
    { until: 491,   rate: 6 },     // 上级上升 12s
    { until: 1547,  rate: 20 },    // 滑行+入轨点火 53s
    { until: 3890,  rate: 60 },    // 部署 39s
    { until: 31938, rate: 150 },   // 在轨滑行 6小时05分 → 187s
    { until: 34132, rate: 30 },    // 离轨 73s
    { until: 35250, rate: 4 },     // 再入 78s
    { until: 35430, rate: 2 },     // 跨音速/着陆 90s
    { until: 1e12,  rate: 2 }
  ];

  /* ---------- 可调参数（面板） ---------- */
  var PARAM_DEFS = [
    { key: 'boosterEngines', label: '助推器引擎数', min: 20, max: 33, step: 1, def: 33, unit: '台',
      desc: '猛禽 3 数量，影响起飞推力与推重比' },
    { key: 'shipEngines', label: '飞船引擎数', min: 3, max: 6, step: 1, def: 6, unit: '台',
      desc: '猛禽数量（含真空版），影响上级推力' },
    { key: 'thrustScale', label: '推力系数', min: 0.8, max: 1.2, step: 0.05, def: 1.0, unit: '×',
      desc: '引擎实际推力缩放（猛禽 3 节流上限/下限）' },
    { key: 'fuelScale', label: '燃料装载', min: 0.7, max: 1.2, step: 0.05, def: 1.0, unit: '×',
      desc: '两级推进剂装载量缩放，影响燃烧时长与 Δv' },
    { key: 'sepAlt', label: '分离高度', min: 40, max: 80, step: 1, def: 62, unit: 'km',
      desc: '热级分离目标高度（真实任务约 62-65km）。自适应模式下自动驾驶据此重排俯仰程序' },
    { key: 'recovery', label: '助推器回收', type: 'select', options: ['溅落美洲湾（真实）', '发射塔捕获'], def: 0,
      desc: '真实 IFT-14 为美洲湾溅落并演示 FTS；塔架捕获为备选挑战配置' }
  ];

  function defaultParams() {
    var p = {};
    PARAM_DEFS.forEach(function (d) { p[d.key] = (d.type === 'select') ? d.def : d.def; });
    return p;
  }

  /* 任务时钟 → 当前压缩倍率 */
  function rateAt(clock) {
    for (var i = 0; i < PROFILE.length; i++) {
      if (clock < PROFILE[i].until) return PROFILE[i].rate;
    }
    return PROFILE[PROFILE.length - 1].rate;
  }

  /* 时间格式化：T+MM:SS 或 T+H:MM:SS */
  function fmtClock(t) {
    var neg = t < 0;
    var s = Math.abs(Math.round(t));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    function z(n) { return (n < 10 ? '0' : '') + n; }
    var str = h > 0 ? h + ':' + z(m) + ':' + z(ss) : z(m) + ':' + z(ss);
    return (neg ? 'T-' : 'T+') + str;
  }

  return {
    TIMELINE: TIMELINE,
    PROFILE: PROFILE,
    PARAM_DEFS: PARAM_DEFS,
    defaultParams: defaultParams,
    rateAt: rateAt,
    fmtClock: fmtClock
  };
})();
if (typeof window !== 'undefined') window.MISSION14 = MISSION14;
