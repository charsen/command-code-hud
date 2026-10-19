# Command Code HUD

在 [Command Code](https://commandcode.ai) 输入区下方常驻显示模型、项目、Git 状态、上下文、
缓存命中、工具、子代理、轮次和会话 Token。不修改 Command Code 本体。

参考 [Codex HUD](https://github.com/konnga/codex-hud) 与 Claude HUD。

## 仓库

- Gitee：<https://gitee.com/charsen/command-code-hud>
- GitHub：<https://github.com/charsen/command-code-hud>

```text
[glm-5.3 high] │ command-code-hud git:(main*) M2 A1 ?1 │ HUD work
上下文 ▄▄▁▁▁▁▁▁▁▁ 21% · 210K/1M │ 缓存 7.2M · 95%
配额 5小时 ▄▄▄▁▁▁▁▁▁▁ 32% · 3h 12m │ 周 ▄▄▄▄▁▁▁▁▁▁ 41% · 2d 4h │ 月 ▄▄▄▁▁▁▁▁▁▁ 29% ($23.4/$80)
模式: default │ 工具: ✓ shell_command ×41 ✓ read_file ×9 │ 子代理: explorer×1
⏱ 3h 14m │ 轮次 6 │ Token 7.6M (输入 7.6M · 缓存 7.2M · 95% · 输出 32.4K) │ 压缩 2                    HUD 0.1.0
```

## 展示内容

| 行 | 数据 | 来源 |
| --- | --- | --- |
| 身份 | 模型、推理级别、项目名、Git 分支与改动计数 | `getModel`、`getEffort`、`git status` |
| 上下文 | 上下文进度条、已用/窗口 Token、缓存 Token 与命中率 | `getContextUsage`、`turn_end` usage |
| 配额 | 5 小时、周、月三个窗口，重置时间与花费 | 拦截 `/alpha/billing/credits` 响应、本地 transcript 估算，或手动快照 |
| 活动 | 权限模式、正在运行/已完成的工具及次数、活动子代理 | `permission_mode_changed`、工具与子代理事件 |
| 会话 | 时长、轮次、输入/缓存/输出 Token、压缩次数、HUD 版本 | 事件 + 会话私有条目 |

没有数据的行不会绘制；尚未测量的上下文显示 `—`，不会伪造 `0%`。

## 安装

免安装试用：

```bash
cmd --mod /path/to/command-code-hud/src/index.ts
```

安装到所有项目（用户级）：

```bash
cmd mods add /path/to/command-code-hud -g
```

发布到 npm 后可直接：

```bash
cmd mods add command-code-hud -g
```

安装后重启 Command Code（或执行 `/mods reload`）。用以下命令确认：

```bash
cmd mods list
cmd mods inspect /path/to/command-code-hud/src/index.ts
```

会话内执行 `/hud status`。

卸载：`cmd mods remove command-code-hud -g`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/hud` 或 `/hud status` | 查看预设、位置、语言、上下文百分比和已启用项 |
| `/hud preset full\|essential\|minimal\|presentation` | 应用预设 |
| `/hud lang en\|zh` | 切换语言 |
| `/hud plan go\|goat\|pro\|max10\|max20\|team-pro\|custom` | 设置本地估算使用的套餐上限（`custom <月度> <5小时> <周>`） |
| `/hud quota` | 查看配额来源、三个窗口、重置时间和精确快照时间 |
| `/hud quota set 5h=32 1w=41 [month=29] [used=23.4 cap=80]` | 录入从 `/usage` 读到的精确值 |
| `/hud quota auto\|exact\|local` | 优先使用捕获快照、只用快照、或只用本地估算 |
| `/hud quota refresh` / `/hud quota clear` | 重新扫描 transcript / 清除精确快照 |
| `/hud quota cycle <1-28\|auto>` | 设置本地月度的账单日；`auto` 为滚动 30 天 |
| `/hud on` / `/hud off` / `/hud toggle` | 显示或隐藏（也可用 `alt+h`） |
| `/hud enable <items>` / `/hud disable <items>` | 开关单个片段 |
| `/hud position above\|below` | 放在输入区上方或下方 |
| `/hud color on\|off` | ANSI 颜色（遵循 `NO_COLOR`） |
| `/hud bar block\|half\|none` | 进度条样式：整块、半高（默认）或不显示 |
| `/hud footer on\|off` | 在状态行追加紧凑的 `HUD ctx 21%` |
| `/hud reset` | 恢复默认 |
| `/hud debug` | 输出最近一次原始 usage 与实时统计 |

可用片段：`identity`、`project`、`title`、`context`、`cache`、`quota`、`mode`、`tools`、
`agents`、`turns`、`session`、`version`。也接受 `model`、`git`、`ctx`、`permission`、
`tokens`、`subagents` 等别名。

预设：

| 预设 | 内容 |
| --- | --- |
| `full` | 全部（默认） |
| `essential` | 身份、项目、上下文、缓存、配额、工具、会话、版本 |
| `minimal` | 项目与上下文 |
| `presentation` | 身份、项目与上下文 |

单次会话覆盖：

```bash
cmd --mod-option hud-preset=minimal --mod-option hud-lang=zh --mod-option hud-position=above
cmd --mod-option hud-plan=goat
```

## 配置

`/hud` 的修改写入 mod store（`~/.commandcode/mods/.store/` 下每个 mod 一个 JSON 文件），重启
后仍然生效。命令行 flag 只影响当前会话，不覆盖已保存配置。

上下文、轮次、Token 总量、压缩次数、子代理 Token 和会话开始时间还会作为私有 custom entry
写入会话记录，因此 `--resume` 后可以恢复。

配额拦截只保存计费响应体（用量数字）、URL 和状态码，**不保存**请求头、token 或 cookie；
捕获到的请求头只存在于进程内存，用于 5 分钟重放。本地估算只读取 transcript 里的
`timestamp`、`id` 和 `usage.costUsd`，不读取 prompt 内容，也不打开 `auth.json`。

## 已知限制

- **配额来自 CLI 自己的计费请求。** `/usage` 覆盖层本身是私有 UI：不触发 `command_output`、
  不写入 transcript，ModApi 也没有额度 getter。但覆盖层请求的是
  `api.commandcode.ai/alpha/billing/credits`，所以 mod 包装 `globalThis.fetch`，直接读取该
  响应：5 小时/周的 `used`/`cap`/`resetAt`，以及月度剩余 `monthlyCredits`；再按 caps 反推
  套餐并保存快照。CLI 的正常请求头只保存在**进程内存**里，mod 每 5 分钟用它们重放一次请求。
  不读取 `auth.json`，不持久化 token。
- **计费接口是内部接口，可能变化。** 如果 URL 或响应结构改变，捕获会停止，HUD 退回手动快照
  或本地估算；`/hud quota` 会显示当前来源。
- **手动覆盖和本地兜底仍然保留。** `/hud quota set 5h=32 1w=41 month=29 used=23.4 cap=80`
  可手工录入；没有 API 快照时，HUD 汇总 `~/.commandcode/projects/**/*.jsonl` 的 `costUsd`
  和时间戳，按 `/hud plan` 的 caps 计算。本地估算只统计本机，窗口锚点按本机第一条请求模拟，
  低额度模型的 credit 扣减可能高于原始成本。本地月度窗口默认是**滚动 30 天**，不假设每个人
  的账单日；需要自然账期时用 `/hud quota cycle <1-28>`，`/hud quota cycle auto` 回到滚动
  30 天。API 的精确月度百分比不受这个设置影响。
- **初始权限模式未知。** 没有 `getPermissionMode()`，只有第一次 `permission_mode_changed`
  事件（例如 `shift+tab` 之后）才能显示。
- **工具次数在 resume 后重置。** Token 总量、轮次、压缩会持久化，工具计数从新进程重新开始。
- **缓存字段取决于 provider。** 不同 provider 的 usage 键名不一致，归一化层兼容常见的
  snake_case / camelCase；可通过 `/hud debug` 查看原始 payload。
- HUD 使用输入区下方的 widget 带，而不是内置单行状态栏，因为内置状态栏没有上下文/Token 项。

## 开发

```bash
npm install
npm run check        # tsc --noEmit + vitest
```

入口是 `src/index.ts`，由 Command Code 的 jiti 直接加载，无需构建。`@commandcode/harness`
没有发布到 npm，本项目在 `src/types.ts` 里只声明了实际用到的那部分 API。

## 许可证

MIT
