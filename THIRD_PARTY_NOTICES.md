# 第三方声明 / Third-Party Notices

## 简体中文

本项目使用由 `package-lock.json` 管理的开源依赖。

`0.1.0` 预览版的依赖树已根据 `package-lock.json` 做过一次仓库级检查，目前包含以下许可证族：

- MIT：197 个包
- ISC：10 个包
- BSD-3-Clause：4 个包
- Apache-2.0：3 个包
- BSD-2-Clause：2 个包
- MIT OR CC0-1.0：1 个包
- CC-BY-4.0：1 个包

值得注意的传递依赖：

- `caniuse-lite` 使用 CC-BY-4.0 许可证。

直接运行/构建依赖包括：

- `@vitejs/plugin-react`
- `electron-vite`
- `react`
- `react-dom`
- `electron`
- `typescript`
- `vite`

正式发布打包时，应基于该 release 使用的精确 lockfile 重新生成第三方许可证报告，并随 release artifact 一起提供。本文件是仓库级声明，不可替代对 provider、模型或操作系统分发条款的审查。

---

## English

This project uses open-source dependencies managed through `package-lock.json`.

The dependency tree was reviewed from `package-lock.json` for the `0.1.0` preview. It currently contains packages under these license families:

- MIT: 197 packages
- ISC: 10 packages
- BSD-3-Clause: 4 packages
- Apache-2.0: 3 packages
- BSD-2-Clause: 2 packages
- MIT OR CC0-1.0: 1 package
- CC-BY-4.0: 1 package

Notable transitive dependency:

- `caniuse-lite` is licensed under CC-BY-4.0.

Direct runtime/build dependencies include:

- `@vitejs/plugin-react`
- `electron-vite`
- `react`
- `react-dom`
- `electron`
- `typescript`
- `vite`

For release packaging, generate a fresh third-party license report from the exact lockfile used for the release and include it with the release artifact. This file is a repository-level notice and should not be treated as a substitute for reviewing provider, model, or operating-system distribution terms.
