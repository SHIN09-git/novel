# DeepSeek V4.1 Flash 对照检查 / Comparison Preflight

日期：2026-09-22。

## 本次决定

作者已指定 DeepSeek V4.1 Flash，费用上限 **5 元人民币**，并允许无法对照时跳过、继续优化。官方 API 名称为 `deepseek-flash`，不是直接把显示名称 `v4.1flash` 传给接口。

本次没有发出付费请求，费用为 **0 元**。当前进程没有 `NOVEL_DIRECTOR_API_KEY` 或 `DEEPSEEK_API_KEY`；现有隔离 CLI 执行器使用前者，不能直接读取桌面 Electron 的加密凭据。这不表示桌面设置中的密钥丢失或不可用。没有为测试导出桌面明文密钥、修改作者设置或读取小说正文。

因此，本轮真实质量/费用对照按作者指示跳过，不再以“尚未提供模型或预算”作为阻塞原因。现有三组虚构任务及 standard/fast 共六份上下文保持离线准备状态；没有生成正文、评分、采纳结果或模型费用收益结论。恢复付费对照时仍需在执行器侧限定累计预算、输出上限和重试，不能把这次授权视为无限期后台调用许可。

## 已定位的兼容问题

工作台此前只对官方主机上的 `deepseek-v4-flash` 和 `deepseek-v4-pro` 显式发送 `thinking: { type: 'disabled' }`。改用新版 `deepseek-flash` 后却落入服务商默认行为；DeepSeek 默认开启思考模式，因此仅修改模型名称就可能改变等待时间和输出预算分配。

本轮将官方 Flash 名称及旧 Vision Flash 别名纳入同一请求规则，保持工作台既有的非思考调用行为。不会更改作者保存的模型，不影响第三方兼容端点，不调整质量门禁、Prompt、正文或思考模型的一般策略。这项修复消除的是请求参数不一致，**不能据此宣称生成速度或文学质量提升**。

## 复现与验证

- 离线对照准备：`npm run compare:prepare -- --output tmp/model-comparison-new-run`，输出目录必须尚不存在；此命令不会调用模型。
- AI 请求测试使用本地模拟传输，检查实际请求体、官方主机边界、未知模型和旧名称兼容，不使用真实凭据。
- 原有三任务离线材料：`tmp/model-comparison-preview14-20260922/manifest.json`。其中 `allowedToCallModels: false` 是离线产物的安全属性，不表示作者没有授权。
- `npm run typecheck`、完整 `npm test`（143/143 验证脚本）、`npm run build` 通过；请求体矩阵覆盖新版、旧 Flash、旧 Vision Flash、原有 Pro、第三方主机、仿冒主机和未知模型。
- `0.1.6-preview.15` 安装包与 unpacked 已同步，实际包的 SQLite 启动 smoke 及源码目录 Node 原生绑定检查通过。没有重新测 UI 时延，也没有远程模型结果。

## 交付

- 直接运行：仓库下 `release/win-unpacked/Novel Director.exe`。
- 安装包：仓库下 `release/Novel Director Setup 0.1.6-preview.15.exe`。
- SHA-256：`93FA02664EF627F72A2BE6E8823005E20FEA94A9641209A7CC1497A80D9E3DB0`。
- 构建记录：`release/BUILD_INFO.json`。旧包完整归档在 `releases/archive/v0.1.6-preview.14-2026-09-22T10-10-24-657Z/`，没有改写用户数据库。
- 原始本地日志：`tmp/deepseek-flash-tests.log`、`tmp/deepseek-flash-build.log`、`tmp/deepseek-flash-package.log`。
- 本地包未签名、未上传 GitHub；原有 UI 性能与截图证据仍属于 Preview.14，不冒充本补丁的逐屏验收。

## 官方依据

- [当前模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)：`deepseek-flash` 对应 V4.1 Flash；旧 Flash / Vision Flash 名称路由到同一版本。
- [中文首次调用说明](https://api-docs.deepseek.com/zh-cn/)：模型名称及 API 兼容方式。
- [思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)：请求中的思考模式控制。

## English Summary

The author approved DeepSeek V4.1 Flash with a CNY 5 cap and explicitly allowed skipping an unavailable comparison. The official model ID is `deepseek-flash`. The isolated runner has no API-key environment variable and does not read Electron's encrypted desktop credentials. No paid request was made; cost is zero. Prepared synthetic contexts are not generated prose or quality/cost evidence.

The compatibility fix keeps the official current Flash name and legacy Flash aliases on the existing non-thinking request path. It does not change saved settings, third-party endpoints, prompts or author data. A parameter fix alone is not proof of faster or better prose.

Preview.15 passes typecheck, all 143 validation scripts, production build, packaged SQLite smoke and the root Node native-binding check. The installer and unpacked app are updated; Preview.14 is archived. No user database was modified. This is an unsigned local package, not a GitHub publication or a paid-model performance result.
