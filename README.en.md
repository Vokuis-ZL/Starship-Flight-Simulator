<div align="center">

# STARSHIP FLIGHT 14 — Full-Mission IFT-14 Flight Simulator

**SpaceX Starship Flight 14 · First Orbital Flight · High-Fidelity Browser Simulation**

[![Version](https://img.shields.io/badge/version-2.0-blue.svg)](#-changelog)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Firefox-lightgrey.svg)](#2-quick-start)
[![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](#2-quick-start)
[![File Size](https://img.shields.io/badge/size-~124KB-orange.svg)](#2-quick-start)
[![Tests](https://img.shields.io/badge/tests-5%2F5%20passing-brightgreen.svg)](#-development--build)

简体中文 | **[English](README.en.md)**

*Single file · Zero dependencies · Just open & fly · Real mission timeline · Manual/Auto pilot · Full failure simulation*

</div>

---

## Table of Contents

- [Introduction](#1-introduction)
- [Quick Start](#2-quick-start)
- [First-Launch Flow](#3-first-launch-flow)
- [Pilot Modes](#4-two-pilot-modes)
- [Mission Parameters](#5-mission-parameters)
- [Time & Playback](#6-time--playback)
- [Mission Roadmap](#7-mission-roadmap)
- [Controls](#8-controls)
- [HUD Instruments](#9-hud-instruments-spacex-webcast-style)
- [Failure Model](#10-failure-model)
- [Real Mission Timeline](#11-real-mission-timeline-ift-14)
- [Development & Build](#12-development--build)
- [FAQ](#13-faq)

---

## 1. Introduction

This project is a **browser-native, full-mission Starship flight simulator** modeled after SpaceX **Starship Flight 14 (IFT-14, September 28, 2026)** — the first Starship mission to reach orbit and deploy real payloads (26 Starlink V3 satellites).

The entire deliverable is **a single HTML file** — nothing to install, no internet required, no runtime environment. Just open it and fly.

### Key Features

- **Real mission timeline** — 24 nodes second-aligned with the official SpaceX T+ schedule (MECO T+02:20, hot staging T+02:22, splashdown T+07:01, orbital insertion T+25:47…)
- **Manual / Auto dual mode** — autopilot executes the real script end-to-end; manual mode puts throttle, pitch, yaw, roll, engines, grid fins, separation and landing flip in your hands
- **Interactive mission parameters** — engine counts, thrust scale, propellant load, separation altitude, recovery mode; every change reflects instantly in thrust, propellant, trajectory and visuals
- **Full failure simulation** — dynamic-pressure break-up, g-overload, re-entry burn-up, crash on touchdown, missed targets, fuel exhaustion — each with a detailed failure report and one-click restart
- **Mission roadmap** — pre-launch trajectory briefing + live in-flight timeline rail (nodes check off, current stage highlighted, hover for details)
- ⏱ **Dual time system** — smart compression (full mission in ~10 minutes) and 1× real time (9 h 50 m) at any moment
- **SpaceX-webcast-style HUD** — circular dials, mission clock, event ticker, attitude indicator, engine array
- **Live synthesized audio** — WebAudio engine rumble following throttle and air density (silent in vacuum)
- **Full Chinese interface** with an English README

---

## 2. Quick Start

| Method | Action |
|---|---|
| Local file | Double-click `星舰飞行仿真.html` in any modern browser (Chrome / Edge / Firefox) |
| Recommended | 1440×900 or higher, fullscreen (`F11`) for the best experience |
| Offline | Physics, rendering and audio are all generated locally in real time |

> No Node.js, no Python, no build step required — the single HTML file *is* the deliverable.

---

## 3. First-Launch Flow

```
Main Menu → Tutorial (5 cards, first visit only) → IFT-14 Mission Briefing → Countdown T-00:17 → Ignition → Full mission
```

1. **Main Menu**: choose pilot mode (Auto / Manual), click 「开始任务」
2. **Tutorial**: 5 cards covering instruments, keys and the failure model (first visit only)
3. **IFT-14 Mission Briefing**:
 - Left: **trajectory profile** — altitude-vs-time curve with all 24 nodes (hover for details)
 - Right: **mission parameters** editor + flight-program selector (Script / Adaptive)
4. Click **发射** (Launch) → T-00:17 final countdown begins

---

## 4. Two Pilot Modes

### AUTO

Full-mission autopilot. In the default **Script mode** the flight follows the real IFT-14 timeline to the second — including real in-flight events (one Raptor shut down during ascent, one RVac shut down early with a 5-engine extended burn, a propellant-depletion boostback, and the post-splashdown FTS demonstration).

### ‍ MANUAL

You fly the active vehicle (`TAB` switches booster ↔ ship); the other stays on autopilot. Every input feeds the physics model:

- Over-aggressive attitude → structural overload break-up
- Not belly-down during re-entry → burn-up
- Too fast at touchdown → crash

> Toggle anytime with `A` or the AUTO/MANUAL chip.

---

## 5. Mission Parameters

Adjustable in the **Mission Briefing** or the in-flight drawer (`H`). Changes reflect instantly in thrust, propellant, trajectory and visuals:

| Parameter | Range | Default | Physical effect |
|---|---|:---:|---|
| Booster engines | 20 ~ 33 | 33 | Liftoff thrust & T/W ratio |
| Ship engines | 3 ~ 6 | 6 | Upper-stage thrust & burn duration |
| Thrust scale | 0.80 ~ 1.20× | 1.00 | Raptor throttle ceiling scaling |
| Propellant load | 0.70 ~ 1.20× | 1.00 | Two-stage propellant → burn time & Δv budget |
| Separation altitude | 40 ~ 80 km | 62 km | Hot-staging target (real: ~62-65 km) |
| Booster recovery | Gulf splashdown / Tower catch | Splashdown | Splashdown is the real IFT-14 profile; tower catch is a challenge mode |

**Two flight programs:**

| Program | Behavior | Best for |
|---|---|---|
| **Script mode (real timeline)** | Parameters lock at launch; the mission follows the real T+ schedule. Weakened configs fail realistically | Experiencing the real mission second by second |
| **Adaptive mode** | Edit parameters any time — even mid-flight. The autopilot recomputes T/W, pitch guidance, boostback Δv, re-entry strategy and landing | Exploring "what if SpaceX flew it this way" |

> Adaptive mode is fuel-aware: below 7% remaining propellant it shuts down early (SECO) to preserve landing reserves.

---

## 6. Time & Playback

The real IFT-14 mission lasts **9 h 50 m** (~8 h of orbital coasting):

| Playback | Description |
|---|---|
| **Smart Compressed** (default) | Phase-aware rates — ascent 2.5×, boostback/coast 4×, orbital coast up to 150×, re-entry 4×, landing 2× — full mission in ~**10 minutes** |
| **1× Real Time** | Click the 「真实」 chip to experience every second of the real 9h50m mission |
| **1× / 2× / 5×** | Manual multipliers on top of smart compression |

The central T+ clock always shows the **real mission clock** (`T+MM:SS` / `T+H:MM:SS`), second-aligned with the official SpaceX timeline.

---

## 7. Mission Roadmap

- **Pre-launch**: the **trajectory profile** in the briefing — altitude-vs-time curve with all 24 nodes (hover for details)
- **In flight**: the **side timeline rail** on the right edge
 - Nodes positioned by real T+ time
 - Completed nodes green check, current node white highlight, future nodes dim
 - A white progress cursor tracks the mission clock live
 - Hover any node for its story card (name + time + description)
 - Press `T` or the 「时间线」 chip to expand/collapse

---

## 8. Controls

| Key | Action | Key | Action |
|:---:|---|:---:|---|
| `W` / `S` | Throttle up/down | `E` | Engine ignite/cutoff |
| `↑` / `↓` | Pitch | `G` | Grid fins |
| `←` / `→` | Yaw | `F` | Landing flip |
| `Q` / `E` | Roll | `X` | Stage separation |
| `TAB` | Switch vehicle (booster ↔ ship) | `A` | Auto/Manual toggle |
| `1` / `2` / `3` | Speed 1×/2×/5× | `P` | Pause |
| `T` | Timeline rail | `H` | Control drawer |
| `R` | Restart | `ENTER` | Launch/confirm |

> Hover the **bottom screen edge** or click the 「控制面板」 chip to open the graphical drawer: throttle/pitch/yaw/roll sliders, engine/fins/flip/separation buttons, live guidance, mission checklist and the full keymap.

---

## 9. HUD Instruments (SpaceX-webcast style)

| Position | Content |
|---|---|
| **Bottom-left** | `SPEED` (km/h) and `ALTITUDE` (km) dials with rotating tick rings |
| **Center** | T± mission clock (real time) + white arc + 「STARSHIP FLIGHT 14」 + amber event ticker (8 s fade) |
| **Bottom-right** | **Attitude indicator**: pitch-driven vehicle silhouette, roll ring<br>**Engine gauge**: 33-dot array (3/10/20 rings) lit live + fuel arc |
| **Top** | Mode (AUTO/MANUAL) · speed (1×/2×/5×/REAL) · pause · sound · drawer chips |
| **Right edge** | Mission timeline rail (see §7) |

 Engine rumble is synthesized live with WebAudio — volume follows throttle and air density, fading to silence in vacuum.

---

## 10. Failure Model

These conditions end the mission with a specific failure report, flight statistics and one-click restart:

| Failure | Trigger |
|---|---|
| Structural break-up | Dynamic pressure exceeded (too fast, too low) or over-aggressive dive |
| Structural overload | Load factor limits (ship >20 g, booster >6.5 g) |
| Re-entry burn-up | Heat flux exceeded — too steep an angle or wrong attitude (keep belly-down!) |
| Crash on touchdown | Excessive vertical/horizontal speed or tilt at landing/splashdown |
| Off-target | Missed splashdown zone / recovery point / landing zone |
| Fuel exhaustion | Burn budget exceeded (adaptive autopilot shuts down early to preserve reserves — manual heroics are on you) |

---

## 11. Real Mission Timeline (IFT-14)

These nodes are built into the simulation (source: official SpaceX mission timeline) and executed second-by-second in Script mode:

| T+ | Event | Notes |
|:---:|---|---|
| T-00:17 | Final countdown | Countdown begins |
| T-00:03 | Ignition | 33 Raptor 3 engines, ~7,600 tf of thrust |
| T+00:00 | Liftoff | Vehicle clears the pad |
| T+00:58 | Max-Q | Maximum dynamic pressure |
| T+01:15 | Supersonic | Past Mach 1 |
| T+02:20 | MECO | Main engine cutoff (one Raptor shut down in flight — 32 engines) |
| T+02:22 | Hot staging | Ship ignites while still attached |
| T+02:27 | Boostback burn | 31 engines, deliberately depleting main LOX (performance-limit test) |
| T+03:07 | Boostback cutoff | Ballistic coast back |
| T+06:35 | Landing burn | 11 → 5 → 3 engines, staged throttle-down |
| T+07:01 | Booster splashdown | Gulf of Mexico; FTS demo afterwards |
| T+08:11 | SECO-1 | One RVac shut down early, 5 engines extended the burn |
| T+25:28 | Orbital insertion burn | First-ever Starship OIB (single sea-level Raptor, 19 s) |
| T+25:47 | Orbit achieved | 275 km circular orbit — Starship orbits Earth for the first time |
| T+34:18 | Deployment begins | 26 Starlink V3 satellites (1 Tbps each) |
| T+01:04:50 | Deployment complete | All 26 satellites orbiting with laser links established |
| T+08:52:18 | Deorbit burn | After ~6 orbits, first-ever Starship deorbit burn |
| T+09:28:52 | Atmospheric entry | ~7.4 km/s, heat-shield belly into the airflow |
| T+09:47:30 | Transonic | Below Mach 1, flaps control attitude |
| T+09:50:11 | Landing burn | All 3 sea-level Raptors re-lit |
| T+09:50:13 | Landing flip | Belly-down → tail-down |
| T+09:50:30 | Pacific splashdown | Precise splashdown — first orbital mission complete |

---

## 12. Development & Build

### Project layout

```
space x仪表盘/
space x仪表盘/
├── 星舰飞行仿真.html      # Final deliverable: single-file build (double-click to run)
├── 参考.jpg               # SpaceX webcast reference screenshot
├── README.md              # Chinese README
├── README.en.md           # This file (English)
└── dev/                   # Source
    ├── CONTRACT.md        # Module interface contract v1
    ├── CONTRACT14.md      # IFT-14 upgrade contract addendum
    ├── mission14.js       # Real timeline / compression profile / parameter defs
    ├── physics.js         # Physics + autopilot (v2: script/adaptive)
    ├── render.js          # Canvas rendering (camera/FX/particles/explosions)
    ├── ui.js / ui.css     # All UI DOM / styles
    ├── test_physics.js    # Headless automated tests (node)
    ├── build.js           # Build script: inlines everything into one HTML
    └── physics_v1.bak     # v1 physics backup
```

### Commands

```bash
# Run automated tests (5 suites: script timeline / adaptive params / live param edits / extreme params / manual smoke)
node dev/test_physics.js

# Rebuild the single-file deliverable after editing sources
node dev/build.js
```

### Architecture

Four global modules + a main loop. Interface contracts: `dev/CONTRACT.md` and `dev/CONTRACT14.md`.

| Module | Responsibility |
|---|---|
| `MISSION14` | Real mission data: 24 timeline nodes, compression profile, parameter definitions |
| `PHYS` | Numerical integration (thrust/gravity/drag/propellant/dynamic pressure/heat/g-load) + per-vehicle autopilot state machines (script/adaptive) + mission clock |
| `RENDER` | Canvas 2D side-profile world: sky gradients, stars, tower & catch arms, vehicles, flames, re-entry plasma, explosion particles, screen shake |
| `UI` | SpaceX-style HUD, mission briefing, timeline rail, drawer, tutorial & modals, keyboard, WebAudio audio |

---

## 13. FAQ

<details>
<summary><b>Q: Why does the booster splash down instead of being caught by the chopsticks?</b></summary>

The real IFT-14 booster splashed down in the Gulf of Mexico — the boostback deliberately depleted the main LOX tank as a performance-limit test, and the FTS was armed afterwards to demonstrate safety hardware. Want the catch? Switch 「助推器回收」 to 「发射塔捕获」 in the parameters.
</details>

<details>
<summary><b>Q: Why does nothing seem to happen after orbital insertion?</b></summary>

The real mission coasts in orbit for ~8 hours. Smart compression fast-forwards it at up to 150× (~3 minutes). Click the 「真实」 chip to enjoy all six orbits in real time instead.
</details>

<details>
<summary><b>Q: How do I reach orbit in manual mode?</b></summary>

After hot staging press `TAB` to fly the ship: follow the vertical-speed guidance (pitch ~60-70°), cut engines with `E` once speed ≥7350 m/s above 95 km. During re-entry keep belly-down (pitch ≈90°), press `F` to flip below 3 km, then `E` to ignite the landing burn.
</details>

<details>
<summary><b>Q: My tweaked parameters failed the mission — is that a bug?</b></summary>

No. Script mode runs a fixed timeline, so a weakened vehicle (fewer engines, less propellant) simply can't complete it — that's the point of parameter exploration. Switch to 「自适应模式」 (Adaptive) and let the autopilot do its best with your config.
</details>

<details>
<summary><b>Q: Does it work on mobile?</b></summary>

The UI is desktop-first. It opens on mobile browsers but keyboard controls are unavailable. A desktop browser is recommended.
</details>

---

<div align="center">

**One HTML file · 9 hours 50 minutes · First orbital Starship mission · Fly it yourself**

</div>
