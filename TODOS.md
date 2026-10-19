# TODOS

- [x] 在真实会话中核对 `turn_end` / `model_request_end` 的 usage 字段（已确认 camelCase
      形状并记入 NOTES）。
- [ ] 评估权限模式初始值：目前只能等第一次 `permission_mode_changed`。
- [x] 验证 `command_output` 捕获 `/usage`：已确认不可行（覆盖层，不触发、不落 transcript）。
      已提供 `/hud quota set` 手工录入。
- [x] 完全自动：拦截 CLI 自己的 `/alpha/billing/credits` 响应，每 5 分钟重放（不落 token）。
- [ ] 监控 `/alpha/billing/credits` 的 URL/响应结构变化；变化时捕获会静默停止，需回退提示。
- [x] 月度窗口：默认滚动 30 天，不硬编码账单日；需要自然账期时每人用
      `/hud quota cycle <1-28>` 设置，`auto` 回滚动 30 天。
- [ ] 若 API 未来返回账单周期，可自动填充 `cycleDay`，省去用户手动设置。
- [ ] 本地配额在 Go/GOAT/Pro 下的 credit 折算：目前用 `costUsd` 近似，低额度模型会低估。
- [ ] 工具计数跨 resume 持久化（当前只持久化 Token/轮次/压缩/时长）。
- [ ] 可选：会话图片/对话导航等 Codex HUD 项，按实际使用频率决定是否实现。
