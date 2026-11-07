/**
 * 飞书机器人扩展（feishu-bot）
 *
 * 在 pi 内注册 /feishu 命令，把飞书消息桥接到本机 Pi Agent：
 *   /feishu start   启动机器人（长连接 WebSocket，无需公网/内网穿透）
 *   /feishu stop    停止机器人
 *   /feishu status  查看运行状态
 *   /feishu setup   查看创建飞书应用、配置凭据的步骤
 *
 * 凭据放在 ~/.pi/agent/feishu-bot.env（见同目录 .env.example），
 * 不随插件库提交；配置 FEISHU_AUTO_START=true 可随 pi 自动启动。
 */
import {
  createLarkChannel,
  LoggerLevel,
  type NormalizedMessage,
} from "@larksuiteoapi/node-sdk";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, FEISHU_ENV_FILE } from "./config";
import { PiManager, type ChatSessionState } from "./pi-manager";

type Channel = ReturnType<typeof createLarkChannel>;

const HELP_TEXT = `## 🤖 Pi Agent 机器人

把消息发给我，我会在你指定的目录里执行任务（读写文件、运行命令、改代码等）。

**命令列表**
- \`!help\` / \`帮助\` — 显示本帮助
- \`!cd <目录>\` — 切换工作目录（每个目录独立上下文）
- \`!status\` / \`状态\` — 查看当前会话状态
- \`!reset\` / \`重置\` — 清空当前会话上下文
- \`!stop\` / \`停止\` — 停止当前正在运行的任务

**示例**
- \`帮我看看这个项目里有哪些 TODO\`
- \`!cd C:/Users/12280/my-project\`
- \`解释一下 src/index.ts 的逻辑\`

⚠️ 机器人拥有本机命令执行与文件修改权限，请妥善保管你的飞书账号与白名单配置。`;

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function resolveLogLevel(level: string): number {
  const map: Record<string, number> = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
  };
  return map[level.toLowerCase()] ?? LoggerLevel.info;
}

function describeModel(st: ChatSessionState): string {
  try {
    const m = st.session.model as unknown;
    if (m && typeof m === "object") {
      const id = (m as { id?: string }).id;
      if (id) return id;
    }
    return String(m ?? "未知");
  } catch {
    return "未知";
  }
}

/** 判断是否为内置命令；是则处理并返回 true。 */
async function handleCommand(
  ch: Channel,
  mgr: PiManager,
  config: ReturnType<typeof loadConfig>,
  msg: NormalizedMessage,
  text: string,
): Promise<boolean> {
  const chatId = msg.chatId;
  const replyTo = msg.messageId;
  const reply = (content: string) =>
    ch.send(chatId, { text: content }, { replyTo });

  if (text === "!help" || text === "帮助" || text === "help") {
    await ch.send(chatId, { markdown: HELP_TEXT }, { replyTo });
    return true;
  }

  if (text === "!status" || text === "状态") {
    const st = mgr.get(chatId);
    let markdown: string;
    if (!st) {
      markdown = `**会话状态**\n- 工作目录：${config.pi.defaultCwd}\n- 状态：未初始化（发一条消息即自动创建）`;
    } else {
      const modelId = describeModel(st);
      markdown = [
        "**会话状态**",
        `- 工作目录：${st.cwd}`,
        `- 状态：${st.busy ? "🟡 运行中" : "🟢 空闲"}`,
        `- 模型：${modelId}`,
        `- 思考级别：${st.session.thinkingLevel}`,
        `- 活跃工具：${st.session.getActiveToolNames().join(", ") || "无"}`,
      ].join("\n");
    }
    await ch.send(chatId, { markdown }, { replyTo });
    return true;
  }

  if (text === "!reset" || text === "重置") {
    try {
      await mgr.reset(chatId);
      await reply("✅ 会话已重置，上下文已清空");
    } catch (e) {
      await reply(`❌ 重置失败：${describeError(e)}`);
    }
    return true;
  }

  if (text === "!stop" || text === "停止") {
    const st = mgr.get(chatId);
    if (st?.busy) {
      void st.session.abort().catch(() => {});
      await reply("🛑 已发送停止信号…");
    } else {
      await reply("当前没有正在运行的任务");
    }
    return true;
  }

  const cdMatch = text.match(/^!?cd\s+(.+)$/i);
  if (cdMatch) {
    const target = cdMatch[1].trim().replace(/^["']|["']$/g, "");
    try {
      const st = await mgr.switchCwd(chatId, target);
      await reply(`✅ 工作目录已切换：${st.cwd}`);
    } catch (e) {
      await reply(`❌ ${describeError(e)}`);
    }
    return true;
  }

  return false;
}

/** 在后台运行一次 agent 任务（不阻塞消息 handler，保证飞书 ack 及时返回）。 */
function startTask(
  ch: Channel,
  mgr: PiManager,
  config: ReturnType<typeof loadConfig>,
  st: ChatSessionState,
  msg: NormalizedMessage,
  text: string,
): void {
  const chatId = msg.chatId;
  let emittedAnyText = false;

  st.busy = true;

  ch.stream(
    chatId,
    {
      markdown: async (controller) => {
        // 串行化所有 append，避免并发写入导致乱序
        let chain: Promise<unknown> = Promise.resolve();

        const unsubscribe = st.session.subscribe((event) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta"
          ) {
            const delta = event.assistantMessageEvent.delta;
            if (delta) emittedAnyText = true;
            chain = chain.then(() => controller.append(delta));
          } else if (
            config.pi.showToolStatus &&
            event.type === "tool_execution_start"
          ) {
            const toolName = (event as { toolName?: string }).toolName ?? "unknown";
            chain = chain.then(() =>
              controller.append(`\n\n🛠️ 正在执行工具 \`${toolName}\` …\n\n`),
            );
          }
        });

        try {
          await st.session.prompt(text);
          await chain;
        } finally {
          unsubscribe();
        }
      },
    },
    { replyTo: msg.messageId },
  )
    .then(async () => {
      if (!emittedAnyText) {
        const last = st.session.getLastAssistantText();
        if (last && last.trim()) {
          await ch.send(chatId, { text: last }, { replyTo: msg.messageId });
        } else {
          await ch.send(
            chatId,
            { text: "✅ 已完成（无文本输出）" },
            { replyTo: msg.messageId },
          );
        }
      }
    })
    .catch(async (e) => {
      const errMsg = describeError(e);
      if (!/abort|cancelled|interrupted/i.test(errMsg)) {
        await ch.send(
          chatId,
          { text: `❌ 运行出错：${errMsg}` },
          { replyTo: msg.messageId },
        );
      }
    })
    .finally(() => {
      st.busy = false;
    });
}

export default function feishuBot(pi: ExtensionAPI) {
  let channel: Channel | null = null;
  let manager: PiManager | null = null;
  let starting = false;

  function statusText(): string {
    if (!channel) return "未运行";
    const count = manager ? manager.size : 0;
    return `运行中 · 活跃会话 ${count}`;
  }

  async function stopBot(): Promise<string> {
    if (!channel) return "机器人未在运行";
    const ch = channel;
    channel = null;
    try {
      await ch.disconnect();
    } catch {
      // ignore
    }
    manager?.disposeAll();
    manager = null;
    console.log("✅ 飞书机器人已停止");
    return "✅ 飞书机器人已停止";
  }

  async function startBot(): Promise<string> {
    if (channel) return "机器人已在运行";
    if (starting) return "正在启动…";
    starting = true;
    try {
      const config = loadConfig();
      const mgr = new PiManager(config.pi.defaultCwd, config.pi.sessionsDir);
      const ch = createLarkChannel({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        transport: "websocket",
        policy: {
          dmMode: config.feishu.allowedDmUsers.length > 0 ? "allowlist" : "open",
          dmAllowlist: config.feishu.allowedDmUsers,
          groupAllowlist:
            config.feishu.allowedGroups.length > 0
              ? config.feishu.allowedGroups
              : undefined,
          requireMention: config.feishu.requireMention,
        },
        safety: {
          chatQueue: { enabled: true },
          // 每条消息立即独立处理，不做批合并（agent 场景需要逐条响应）
          batch: { text: { delayMs: 0 } },
          dedup: { ttl: 60_000 },
        },
        loggerLevel: resolveLogLevel(config.feishu.logLevel),
      });

      ch.on("message", async (msg) => {
        const text = (msg.content ?? "").trim();
        if (!text) return;

        try {
          if (await handleCommand(ch, mgr, config, msg, text)) return;

          // 普通消息：交给 Pi Agent
          let st: ChatSessionState;
          try {
            st = await mgr.getOrCreate(msg.chatId);
          } catch (e) {
            await ch.send(
              msg.chatId,
              { text: `❌ 初始化 Pi 会话失败：${describeError(e)}` },
              { replyTo: msg.messageId },
            );
            return;
          }

          if (st.busy) {
            await ch.send(
              msg.chatId,
              { text: "⏳ 上一个任务还在执行中，请稍候，或发送 !stop 停止当前任务" },
              { replyTo: msg.messageId },
            );
            return;
          }

          startTask(ch, mgr, config, st, msg, text);
        } catch (e) {
          console.error("[feishu] 处理消息失败：", e);
          await ch
            .send(
              msg.chatId,
              { text: `❌ 处理消息失败：${describeError(e)}` },
              { replyTo: msg.messageId },
            )
            .catch(() => {});
        }
      });

      ch.on("error", (err) => {
        console.error("[feishu] 错误：", err);
      });
      ch.on("reconnecting", () => console.warn("[feishu] 长连接重连中…"));
      ch.on("reconnected", () => console.info("[feishu] 长连接已恢复"));

      await ch.connect();
      channel = ch;
      manager = mgr;
      console.log("✅ 飞书机器人已连接，等待消息…");
      console.log(`   默认工作目录：${config.pi.defaultCwd}`);
      console.log(
        `   单聊白名单：${config.feishu.allowedDmUsers.length > 0 ? config.feishu.allowedDmUsers.join(", ") : "未设置（开放）"}`,
      );
      console.log(
        `   群聊需 @：${config.feishu.requireMention ? "是" : "否"}`,
      );
      return `✅ 飞书机器人已连接，默认目录：${config.pi.defaultCwd}`;
    } finally {
      starting = false;
    }
  }

  pi.registerCommand("feishu", {
    description: "飞书机器人：start / stop / status / setup",
    getArgumentCompletions: (prefix) => {
      const subs = ["start", "stop", "status", "setup"];
      const items = subs.filter((s) => s.startsWith(prefix));
      return items.length > 0 ? items.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0].toLowerCase() || "status";
      switch (sub) {
        case "start":
        case "run": {
          try {
            const msg = await startBot();
            ctx.ui.notify(msg, "info");
          } catch (e) {
            ctx.ui.notify(`启动失败：${describeError(e)}`, "error");
          }
          break;
        }
        case "stop": {
          const msg = await stopBot();
          ctx.ui.notify(msg, "info");
          break;
        }
        case "status": {
          ctx.ui.notify(`飞书机器人：${statusText()}`, "info");
          break;
        }
        case "setup": {
          ctx.ui.notify(
            `在 ${FEISHU_ENV_FILE} 填写 FEISHU_APP_ID / FEISHU_APP_SECRET，然后 /feishu start（步骤见插件 README）`,
            "info",
          );
          break;
        }
        default: {
          ctx.ui.notify("用法：/feishu start | stop | status | setup", "warning");
        }
      }
    },
  });

  // 配置 FEISHU_AUTO_START=true 时，随 pi 会话启动自动拉起机器人
  pi.on("session_start", () => {
    const auto = (process.env.FEISHU_AUTO_START ?? "").toLowerCase();
    if (auto === "true" || auto === "1") {
      void startBot().catch((e) =>
        console.error("[feishu] 自动启动失败：", describeError(e)),
      );
    }
  });

  // 退出 / reload 时清理长连接与子会话
  pi.on("session_shutdown", () => {
    void stopBot();
  });
}
