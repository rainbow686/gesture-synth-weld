# Gesture Synth Weld

> 兄弟仓：`../gesturesynthweld-app`（pro，私有闭源，gesturesynthweld.app）。本仓是 free（MIT 开源，gesturesynthweld.com）——漏斗上游。关联见 `docs/BRIDGE.md`。

Hand gesture-controlled music synthesizer. Left hand controls harmony (chords, key, mode), right hand controls expression (volume, tone, octave, chord style).

## Role

Free = 产流量 + `pro_gate_*` 埋点（free→pro 是唯一变现通道）。单 sawtooth 合成器、120s 录制，有意保持最小——商业功能（音色/云端/MIDI/协同）一律去 pro 仓，本仓不做。

## For Claude — Docs Map

> `docs/` is fully gitignored (local only). Claude sessions start by reading this table.

| What to read | Where | When |
|---|---|---|
| Current state / next step | `docs/PROJECT-STATE.md` top `📌` | Every new session, first |
| How to start / commands | `docs/STARTUP.md` + `docs/OPERATIONS.md` | Before work |
| Long discussion drafts | `docs/sessions/YYYY-MM-DD-*.md` (append every 3-5 turns) | Resume after compaction |
| Decisions (ADR) | `docs/decisions/ADR-*.md` (index: `decisions/README.md`) | Need background |
| Daily log | `docs/memory/YYYY-MM-DD.md` | Check yesterday's breakpoint |
| Bridge (free→pro) | `docs/BRIDGE.md` + `bridge/contract.md` + `bridge/sync-log.md` | Cross-repo |
| Task queue | `docs/bridge/inbox/*.md` (one file per task, `to: peer`) | Scan for new work |
| After change (write map) | `docs/CLOSEOUT.md` | After every change |
| Handbook (handover/multi-agent) | `docs/handbook/continuity-kit.md` | New project / multi-agent |

Rules: >10 turns discussion → create `sessions/` file and append incrementally (anti-compaction); update `PROJECT-STATE` + `memory/` immediately after each verifiable unit (session may die anytime); after any change walk `docs/CLOSEOUT.md` write map.

## Tech Base

- Stack: Vite + React + TypeScript + Tone.js + MediaPipe Tasks Vision (HandLandmarker).
- Pipeline: 任一输入源产出 `HandFrame` 走同一条音频链（filter → masterGain）。Engine 方法幂等 + 平滑过渡；App 层按 chord fingerprint 去重。
- Inputs: CameraSource（检测 + presence 平滑）/ KeyboardSource（桌面端 hold-to-play，`src/input/keymap.ts` 是绑定单源）。UX 细节读源码，不在此展开。
- Recording: 域 `src/recording/`（chooser → countdown → record → result；音频 / 全视频 / 骨架三模式，9:16 默认）。Mic 只进录制 tap、不进扬声器；成品 auto-save IndexedDB（My recordings，浏览器本地，零上传）。
- Reusable layers（free→pro cherry-pick，单向不回流，台账见 `docs/bridge/sync-log.md`）: `src/input/` `src/recording/` `src/hud/` `src/works/` `src/chords.ts` `src/types.ts`。
- File map: `src/` + `public/`（favicon/og/robots/sitemap + `vX.Y.Z/` 模型版本源）+ `index.html`（SEO + JSON-LD）+ `gesture-synth.html`（品类页）+ `vercel.json`（构建/缓存/301）+ `mediapipe-version.json`。测试 `npm test`（用例数以实跑为准）。

## Pages（SEO + 广告面）

- `/`（Vite SPA）：品牌词主场；首屏 100svh 乐器 + 首屏下 SEO 阅读区。
- `/gesture-synth`（Vite 多入口，同 entry 挂 `src/main.tsx`）：品类词落地页；文字 Hero → 真乐器 → READ 正文；Play 按钮 dispatch `gsw:seo-play`（滚动 + 启动，一次点击）。
- AdSense（reserve-only，阅读区手动单元）：首页 `gsw-read-1`（阅读区中部）+ `/gesture-synth` `gsw-read-2`（READ 区顶部，TOC 之后）——两单元分开归因。Auto/Anchor 后端全关；演奏区 / `app-root` / 交互流程永不放广告。

## Deployment

- 唯一部署 Vercel（push main 自动生产；`vercel.json`：构建 + immutable 缓存头 + `.studio`/`.app` 301 → `.com`）。分支与发布唯一路径见 `docs/OPERATIONS.md`；`main` 只接受 merge。
- DNS 在 Cloudflare（Free），主站记录**仅 DNS**直连 Vercel（不开代理——大陆访问质量不变量）。
- 模型双源：CF worker `gsw-media`（`assets.gesturesynthweld.com`，无限带宽，1 年 immutable 缓存）为主 + 同源 `/vX.Y.Z/` 为大陆兜底。`handTracker.ts` 3s HEAD 探测选源（只从赢家下载，不竞速）；hover/touch 只预取 CF。
- Env: `VITE_ENABLE_EXTERNAL_SCRIPTS`；GA4/Clarity ID 在 index.html（hostname-guarded，fork 须换）。

## MediaPipe Version Updates（季度）

**CRITICAL：1 年 immutable 缓存——同 URL 更新永远到不了老用户。** 每次升级必须换 URL（新 `v<version>` 目录 + 改 `handTracker.ts` 路径 + 重部署 CF），永不覆盖旧目录。

1. `node scripts/check-mediapipe-version.mjs` 看更新 → 2. 读 release notes → 3. `npm install @mediapipe/tasks-vision@<new>`，wasm 拷 `public/v<new>/wasm/` + 下新模型 → 4. 改 `handTracker.ts` 路径 → 5. `wrangler pages deploy <含v<new>+_headers> --project-name gsw-media`（`CLOUDFLARE_API_TOKEN` 临时建，用完删）→ 6. 更新 `mediapipe-version.json` → 7. 分支 → preview 手势回归（VI/VII、拳/mute、左右手、拇指 8vb）→ 8. 用户点头 → 合 main。

## Known Gotchas

- **vercel.json redirects**：destination 参数（`:path*`）必须在 source 里同名，否则全站部署静默死（GitHub status 报 `vercel.link/invalid-route-destination-segment`，面板无记录）。
- **大陆可达**：不用 `*.workers.dev` / `*.vercel.app` / Google CDN（DNS 污染/墙）。模型走自有域 + 同源兜底。
- **TUN 代理下 `dig` 不可信**（fake-ip `198.18.x.x`），DNS 状态用 DoH 查（dns.google / alidns.com）。
- **CF 新部署**落 `*.workers.dev`（Pages 并入 Workers），"Upload assets" 入口已无，用 API 确认实际 URL。

## Current Version

**v2.3** — 120s 录制（timeout 驱动，whatsNew 接棒）。活状态一律 `docs/PROJECT-STATE.md`，方向冻结文档见 `docs/roadmap/`。
