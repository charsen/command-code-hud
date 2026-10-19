# NOTES

## 2026-10-19 Command Code mod 运行时事实

- 本机 Command Code 1.84.0，mod 由 jiti 直接加载 TypeScript，无需构建；入口在 `package.json`
  的 `commandcode.mods` 声明为 `./src/index.ts`。
- `@commandcode/harness` 未发布到 npm（`npm view` 404）。类型只在本地 `src/types.ts` 声明，
  运行时导入全部被擦除，不影响 jiti。
- 内置 `/statusline` 没有上下文/Token 项；多行 HUD 只能用 `cmd.ui.widget`。`setStatus` 只有
  一行且会被终端宽度截断。
- `cmd.getContextUsage()` 在首次模型调用前返回 `tokens: null, percent: null`，不能当成 0%。
- 事件里 `turn_end` 携带本轮 usage，`model_request_end` 携带单次请求 usage；HUD 只用
  `turn_end` 累计，避免重复计数。
- 没有 `getPermissionMode()`；权限模式只能从 `permission_mode_changed` 事件获得，所以会话
  初始模式未知。
- `/usage` 的额度窗口是服务端数据，ModApi 未暴露；不读取 auth 文件、不调用未公开接口。
- usage 的字段名没有公开类型；`src/usage.ts` 兼容 snake_case/camelCase 与嵌套路径，
  `/hud debug` 可打印原始 payload 供核对。实测 Command Code 1.84.0 的 `turn_end` usage 为
  `{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd}`，不含 total，
  因此 total 由输入 + 输出推导。
- 统计条目在 `turn_end` 和 `run_end` 都会触发；已按序列化内容去重，避免同一轮写两条
  custom entry（headless 实测每次运行只有 1 条 `command-code-hud/stats`）。

## 2026-10-19 配额数据来源

- 官方 usage-limits 文档公开了各套餐上限（Go $10/$2/$5，GOAT $70/$14/$35，Pro $80/$16/$40，
  Max 10x $150/$45/$90，Max 20x $300/$90/$180，Team Pro $40/$12/$24，顺序为
  月度/5H/周）。窗口从第一次请求起算，不是自然时钟。
- ModApi 不暴露额度；权威值只在 `/usage` 覆盖层。不要读取 `auth.json` 或调用未公开接口。
- 本地估算读取 `~/.commandcode/projects/**/*.jsonl` 的 `timestamp` + `usage.costUsd`，
  按 id 去重，按第一条本机请求模拟 5H/周窗口。月度默认是**滚动 30 天**（`cycleDay: 0`），
  不假设用户账单日；需要自然账期时用 `/hud quota cycle <1-28>`，每人的值存各自配置。
  v1 配置的隐式默认 `cycleDay: 1` 会在 v2 迁移为 0。API 的精确月度不依赖 `cycleDay`。
  本地估算不包含其他设备/网页使用，且低额度模型的 credit 扣减可能高于原始成本。
- **`/usage` 覆盖层不能从 UI 捕获**：它不触发 `command_output` override，也不写入 transcript。
  但覆盖层会请求 `GET https://api.commandcode.ai/alpha/billing/credits`，mod 通过包装
  `globalThis.fetch` 读取该响应即可，无需读取 `auth.json`。
- 实测响应（2026-10-19）：
  ```json
  {"credits":{"monthlyCredits":60,"purchasedCredits":0,"freeCredits":0},
   "windowLimits":{"fiveHour":{"used":2,"cap":14,"resetAt":1700000000000},
                   "weekly":{"used":7,"cap":35,"resetAt":1700000000000}}}
  ```
  `monthlyCredits` 是**剩余**月度额度；caps 14/35 对应 GOAT（月度 70），所以月度已用 =
  70 - monthlyCredits。`resetAt` 是毫秒时间戳。页面 5H/周/月 9%/20%/10% 与该响应一致
  （取整/时间差会造成 1% 波动）。
- 自动刷新：捕获请求的 headers（`Authorization`、`x-cli-environment` 等）只保存在进程内存，
  每 5 分钟重放同一个 GET；不持久化 header/token。`quota.network` 只存 body/url/status，
  `quota.request` 只存 header 名称用于诊断。
- 热重载注意：旧的 `fetch` wrapper 会继续运行。`network.ts` 用版本号重装 wrapper，确保新代码
  能拿到 request headers；否则只能拿到 body。
- 手动 `/hud quota set` 和本地 `costUsd` 估算仍保留为 API 不可用时的兜底。
- mod store 位于 `~/.commandcode/mods/.store/command-code-hud.json`；`boot` 键用于确认
  热重载已加载当前版本。

## 2026-10-19 安装与验证

- `cmd mods add /path/to/command-code-hud -g` 以本地路径引用安装；卸载用
  `cmd mods remove command-code-hud -g`。
- `cmd mods inspect <path>` 只做词法扫描，不执行 mod，可作为加载前检查。
- `npm run check` = `tsc --noEmit` + `vitest run`，当前 8 个测试文件 / 48 个用例。
