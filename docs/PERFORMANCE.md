# 性能测量 / Performance Measurement

最后测量日期：2026-09-07。10/100/500 章长篇保存、项目切换与 Agent 实测见 [W09/W10 实测记录](./OPTIMIZATION_W09_W10_MEASUREMENT.md)。下方保留 2026-09-03 的小型 UI/Novelty 基线，不与长篇数据混算。

后续 [Agent 概览定向读取](./OPTIMIZATION_AGENT_OVERVIEW_READ.md) 使用同条件成对测试：500 章摘要约 397ms -> 32ms，输出不变；这不是桌面界面或模型调用提速。

本文记录可重复的本机生产性能测量。源码行数和 chunk 大小只用于解释构建结构，不代替真实运行时数据。

## 测量环境

- 系统：Windows x64
- CPU：AMD Ryzen 7 7800X3D，16 logical CPUs
- 内存：约 32 GB
- Node.js：v24.14.0
- Electron：39.8.9
- Chromium：142.0.7444.265
- 构建：`electron-vite` production output
- 数据：独立 `NOVEL_DIRECTOR_SMOKE_USER_DATA` 下的 synthetic fixture，不读取或修改作者项目

## Electron UI 定义

`scripts/benchmark-production-ui.mjs` 通过真实 Electron main/preload/renderer 和 Chrome DevTools Protocol 测量：

- **进程冷启动到可交互**：新 Electron 进程启动后，preload `data.load` 可用、项目列表已读取、`进入`按钮可点击、无 loading boundary。
- **项目工作台渲染**：点击`进入`到 `.dashboard-view` 完整出现。
- **首次生产流水线**：首次点击`生产流水线`到 `.generation-view` 完整出现。
- **再次生产流水线**：返回工作台后再次进入同页，测量模块缓存后的切换。
- **首次 Prompt 构建器**：首次进入 `.prompt-view`；该路径会加载 `promptContext` 重型边界。

每次测量前会先用隔离数据完成一次 SQLite bootstrap；统计阶段不包含旧 JSON 首次迁移。每个 run 使用新的 Electron 进程，但不会清空操作系统磁盘缓存。脚本结束会关闭并确认本次创建的 Electron 进程已经退出。

## 当前基线

以下为本机 p50 / p95，单位为毫秒。UI 数据用于观测，不作为抖动敏感的 CI 硬门禁。

| 场景 | 修复前 p50 / p95 | 当前 p50 / p95 | 结论 |
| --- | ---: | ---: | --- |
| 进程冷启动到可交互 | 830 / 864 | 779 / 792 | `0.1.5` 的 5 次真实 Electron 运行均低于 0.8s，继续作为观测指标而非跨机器硬门禁 |
| 项目工作台 | 332 / 341 | 343 / 347 | p50 基本稳定 |
| 首次生产流水线 | 332 / 341 | 330 / 336 | p50 基本稳定；未发现需要继续拆 chunk 的运行时证据 |
| 再次生产流水线 | 3 / 8 | 4 / 24 | 正常样本保持个位数毫秒 |
| 首次 Prompt 构建器 | 359 / 360 | 358 / 361 | 重型边界按需加载有效 |

本轮将 main-process diagnostics 改为首次调用时动态加载。production main entry 从约 `361.13 kB` 降到 `242.61 kB`，但冷启动 p50 没有稳定改善，因此不把 chunk 下降宣传成启动速度提升。

CDP 的 renderer JS heap 只作为观测值：`0.1.5` 的 5 次测量约为 `4.65–4.90 MB`。它不是 Electron 全进程峰值，不作为硬结论。

## Novelty Audit 基线

`scripts/benchmark-novelty-audit.mjs` 使用真实 `NoveltyDetector` production-style bundle。每档先热身，再进行多次迭代，使用 `performance.now()` 和 nearest-rank p50/p95。

| 中文样本 | 规模 / 迭代 | 修复前 p50 / p95 | 当前 p50 / p95 | p50 变化 |
| --- | ---: | ---: | ---: | ---: |
| small | 2,000 字 / 80 | 6.5 / 8.2 ms | 6.1 / 7.4 ms | 中文边界判断保持在个位数毫秒 |
| medium | 24,000 字 / 40 | 160.6 / 223.1 ms | 16.9 / 19.9 ms | p50 约 9.5x faster |
| large | 160,000 字 / 16 | 4469.0 / 4860.7 ms | 80.6 / 90.9 ms | p50 约 55.4x faster |

稳定硬门禁只覆盖算法级大文本预算：中文回归脚本要求重复长文本 p95 `< 1500ms`。UI 时延预算只记录趋势，避免不同机器、杀毒软件和系统调度造成 CI 假失败。

## 复现命令

```powershell
npm.cmd run build
npm.cmd run native:electron
npm.cmd run perf:ui
npm.cmd run native:node
npm.cmd run perf:novelty
npm.cmd run test:single -- novelty-chinese
```

`better-sqlite3` 的 Node 与 Electron ABI 不同。UI 基准前使用 `native:electron`，随后运行 Node/SQLite 测试前必须使用 `native:node` 恢复。

原始结果：

- [Novelty 修复前](./performance/2026-07-22-novelty-before.json)
- [Novelty 修复后](./performance/2026-07-22-novelty-after.json)
- [UI 修复前](./performance/2026-07-22-ui-before.json)
- [UI 当前基线](./performance/2026-07-22-ui-after.json)

每次发行复测还会写入未提交的本机原始结果：`tmp/performance/novelty-audit.json` 与 `tmp/performance/production-ui.json`。这些文件使用 synthetic fixture，不包含作者项目数据。

---

## English

Last measured: 2026-09-03 on Windows x64, Ryzen 7 7800X3D, 32 GB RAM, Node.js 24.14.0, Electron 39.8.9, and Chromium 142.0.7444.265.

The UI benchmark launches the real production Electron main/preload/renderer processes against synthetic data in an isolated `userData` directory. It measures process-cold interactive readiness, project workbench render, first and cached Generation Pipeline navigation, and first Prompt Builder navigation. Every owned Electron process is verified closed after each run. UI timings are observational because Windows scheduling, antivirus, and disk cache produce large p95 variance.

The Novelty benchmark uses the production implementation with fixed 2K, 24K, and 160K Chinese samples, warmups, repeated iterations, and p50/p95 statistics. In the `0.1.5` release verification, the 160K sample measured 80.6/90.9ms p50/p95 and the 2K sample measured 6.1/7.4ms. Release-local raw results are written to `tmp/performance/` and contain synthetic fixtures only.

Reproduce with:

```powershell
npm.cmd run build
npm.cmd run native:electron
npm.cmd run perf:ui
npm.cmd run native:node
npm.cmd run perf:novelty
npm.cmd run test:single -- novelty-chinese
```

The committed raw JSON files are linked above. The renderer heap values are CDP observations, not whole-application peak memory measurements.
