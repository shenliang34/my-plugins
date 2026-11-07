/**
 * 飞书机器人扩展的配置加载。
 *
 * 凭据读取顺序（不覆盖已存在的 process.env）：
 *   1. ~/.pi/agent/feishu-bot.env  —— 推荐，稳定位置，升级插件包不会被覆盖，也不进 git
 *   2. 扩展目录下的 .env           —— 本地开发方便
 *
 * 之后直接读 process.env（shell / pi 环境变量优先级最高）。
 */
import dotenv from "dotenv";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const agentDir =
  process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");

/** 稳定的凭据/配置文件路径。 */
export const FEISHU_ENV_FILE = path.join(agentDir, "feishu-bot.env");

// 依次加载，override: false 保证 shell / pi 里已有的同名变量优先。
const localEnv = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
for (const file of [FEISHU_ENV_FILE, localEnv]) {
  if (existsSync(file)) {
    dotenv.config({ path: file, override: false });
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`缺少环境变量 ${name}，请在 ${FEISHU_ENV_FILE} 中配置`);
  }
  return value.trim();
}

export interface FeishuBotConfig {
  feishu: {
    appId: string;
    appSecret: string;
    requireMention: boolean;
    allowedDmUsers: string[];
    allowedGroups: string[];
    logLevel: string;
  };
  pi: {
    defaultCwd: string;
    sessionsDir: string;
    showToolStatus: boolean;
  };
  autoStart: boolean;
}

export function loadConfig(): FeishuBotConfig {
  return {
    feishu: {
      appId: requireEnv("FEISHU_APP_ID"),
      appSecret: requireEnv("FEISHU_APP_SECRET"),
      requireMention:
        (process.env.FEISHU_REQUIRE_MENTION ?? "true").toLowerCase() !== "false",
      allowedDmUsers: splitList(process.env.FEISHU_ALLOWED_DM_USERS),
      allowedGroups: splitList(process.env.FEISHU_ALLOWED_GROUPS),
      logLevel: process.env.FEISHU_LOG_LEVEL ?? "info",
    },
    pi: {
      defaultCwd: path.resolve(process.env.PI_DEFAULT_CWD || process.cwd()),
      sessionsDir: path.resolve(
        process.env.PI_SESSIONS_DIR || path.join(agentDir, "feishu-sessions"),
      ),
      showToolStatus:
        (process.env.PI_SHOW_TOOL_STATUS ?? "true").toLowerCase() !== "false",
    },
    autoStart: ["1", "true", "yes"].includes(
      (process.env.FEISHU_AUTO_START ?? "").toLowerCase(),
    ),
  };
}
