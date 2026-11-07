## [1.1.2] - 2026-11-08

- `deepseek-balance`：当前文件夹路径移到状态栏第二行左侧（第一行与底行恢复原样）

## [1.1.1] - 2026-11-08

- `deepseek-balance`：footer 左下角新增显示当前文件夹路径

## [1.1.0] - 2026-11-08

- 新增 `feishu-bot` 扩展：
  - `/feishu start` 启动飞书机器人（长连接 WebSocket，无需公网/内网穿透）
  - `/feishu stop` 停止、`/feishu status` 查看状态、`/feishu setup` 查看配置步骤
  - 每个飞书会话一个独立 Pi 会话，按 (会话, 工作目录) 持久化
  - 凭据放 `~/.pi/agent/feishu-bot.env`，支持 `FEISHU_AUTO_START=true` 自动启动

## [1.0.0] - 2026-02-20

- 新增 `deepseek-balance` 扩展：
  - footer 模型名下方右侧显示本次会话花费与 DeepSeek 账户余额
  - 每次对话结束自动刷新余额
  - `/balance` 命令手动查询余额详情
