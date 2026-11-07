/**
 * DeepSeek 余额查询扩展
 *
 * 功能：
 * 1. 自定义底部状态栏（footer），在模型名称下方、右侧显示「本次会话花费 + 账户余额」，颜色与上方一致（dim）
 * 2. 提供 /balance 命令，随时查询并显示余额详情
 * 3. 每次对话结束（agent_settled）自动刷新余额（HTTP 查询，不消耗 token）
 *
 * 注意：DeepSeek 官方 API 仅提供余额查询接口（/user/balance），
 * 不提供「今日消耗」「总消耗」等用量明细，此类信息需登录
 * https://platform.deepseek.com 查看。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

interface BalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// 模块级状态：最新余额金额，供 footer 渲染使用
let balanceTotal: string | null = null;
let requestRender: (() => void) | null = null;
let refreshInFlight = false;

async function getDeepseekApiKey(): Promise<string | null> {
  try {
    const authPath = join(homedir(), ".pi", "agent", "auth.json");
    const auth = JSON.parse(await readFile(authPath, "utf-8")) as {
      deepseek?: { key?: string };
    };
    return auth?.deepseek?.key ?? null;
  } catch {
    return null;
  }
}

async function fetchDeepseekBalance(timeoutMs = 10_000): Promise<BalanceInfo | null> {
  const key = await getDeepseekApiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { balance_infos?: BalanceInfo[] };
    return data.balance_infos?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 与内置 footer 一致的 token 数量格式化 */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** 将 home 目录缩写为 ~，与内置 footer 一致 */
function formatCwd(cwd: string, home: string): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const insideHome =
    rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!insideHome) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

function addToTotals(totals: UsageTotals, usage: any): void {
  totals.input += usage?.input ?? 0;
  totals.output += usage?.output ?? 0;
  totals.cacheRead += usage?.cacheRead ?? 0;
  totals.cacheWrite += usage?.cacheWrite ?? 0;
  totals.cost += usage?.cost?.total ?? 0;
}

function computeTotals(entries: any[]): { totals: UsageTotals; cacheHitRate?: number } {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let cacheHitRate: number | undefined;

  for (const entry of entries) {
    if (entry.type === "usage") {
      addToTotals(totals, entry.usage);
    } else if (entry.type === "message" && entry.message?.role === "assistant") {
      const usage = entry.message?.usage;
      if (usage) {
        addToTotals(totals, usage);
        const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
        if (promptTokens > 0) cacheHitRate = (usage.cacheRead / promptTokens) * 100;
      }
    } else if (entry.type === "message" && entry.message?.role === "toolResult") {
      if (entry.message?.usage) addToTotals(totals, entry.message.usage);
    } else if (
      (entry.type === "branch_summary" || entry.type === "compaction") &&
      entry.usage
    ) {
      addToTotals(totals, entry.usage);
    }
  }

  return { totals, cacheHitRate };
}

export default function deepseekBalance(pi: ExtensionAPI) {
  async function refreshBalance(notify: boolean, ctx: any): Promise<void> {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const info = await fetchDeepseekBalance();
      balanceTotal = info ? info.total_balance : null;
      requestRender?.();

      if (notify) {
        if (info) {
          ctx.ui.notify(
            `DeepSeek 余额 ¥${info.total_balance}（充值 ¥${info.topped_up_balance} / 赠送 ¥${info.granted_balance}）`,
            "info",
          );
        } else {
          ctx.ui.notify("查询失败：未配置 DeepSeek API Key 或网络错误", "error");
        }
      }
    } finally {
      refreshInFlight = false;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    // 注册自定义 footer：复刻内置布局，并在模型名下方右侧显示余额
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: () => {
          unsub();
          requestRender = null;
        },
        invalidate() {},
        render(width: number): string[] {
          const lines: string[] = [];

          // 第 1 行：工作目录 + git 分支 + 会话名（左对齐，dim）
          let pwd = formatCwd(
            ctx.sessionManager.getCwd(),
            process.env.HOME || process.env.USERPROFILE || "",
          );
          const branch = footerData.getGitBranch();
          if (branch) pwd = `${pwd} (${branch})`;
          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) pwd = `${pwd} • ${sessionName}`;
          lines.push(truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")));

          // 第 2 行：token/上下文统计（左）+ 模型名（右，dim）
          const { totals, cacheHitRate } = computeTotals(ctx.sessionManager.getEntries());
          const statsParts: string[] = [];
          if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
          if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
          if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
          if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
          if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && cacheHitRate !== undefined) {
            statsParts.push(`CH${cacheHitRate.toFixed(1)}%`);
          }
          if (totals.cost) statsParts.push(`$${totals.cost.toFixed(3)}`);

          const contextUsage = ctx.getContextUsage();
          const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const percent = contextUsage?.percent ?? null;
          let contextStr: string;
          if (percent === null || percent === undefined) {
            contextStr = `?/${formatTokens(contextWindow)}`;
          } else {
            contextStr = `${percent.toFixed(1)}%/${formatTokens(contextWindow)}`;
          }
          if ((percent ?? 0) > 90) contextStr = theme.fg("error", contextStr);
          else if ((percent ?? 0) > 70) contextStr = theme.fg("warning", contextStr);
          statsParts.push(contextStr);

          let statsLeft = statsParts.join(" ");

          // 右侧：模型名 + thinking level
          const modelName = ctx.model?.id || "no-model";
          let rightSide = modelName;
          if (ctx.model?.reasoning) {
            const level = ctx.thinkingLevel || "off";
            rightSide = level === "off" ? `${modelName} • thinking off` : `${modelName} • ${level}`;
          }
          if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
            const withProvider = `(${ctx.model.provider}) ${rightSide}`;
            if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) {
              rightSide = withProvider;
            }
          }

          let statsLeftWidth = visibleWidth(statsLeft);
          if (statsLeftWidth > width) {
            statsLeft = truncateToWidth(statsLeft, width, "...");
            statsLeftWidth = visibleWidth(statsLeft);
          }

          let statsLine: string;
          const rightSideWidth = visibleWidth(rightSide);
          if (statsLeftWidth + 2 + rightSideWidth <= width) {
            const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
            statsLine = statsLeft + padding + rightSide;
          } else {
            const available = width - statsLeftWidth - 2;
            if (available > 0) {
              const truncatedRight = truncateToWidth(rightSide, available, "");
              const padding = " ".repeat(
                Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight)),
              );
              statsLine = statsLeft + padding + truncatedRight;
            } else {
              statsLine = statsLeft;
            }
          }

          // statsLeft 内可能含彩色 context 部分，分开应用 dim，与内置 footer 一致
          const dimStatsLeft = theme.fg("dim", statsLeft);
          const remainder = statsLine.slice(statsLeft.length);
          const dimRemainder = theme.fg("dim", remainder);
          lines.push(dimStatsLeft + dimRemainder);

          // 第 3 行：本次会话花费 + 余额，右对齐 + dim（位于模型名下方）
          const costStr = `本次 $${totals.cost.toFixed(3)}`;
          const right3 = balanceTotal !== null ? `${costStr} · DeepSeek 余额 ¥${balanceTotal}` : costStr;
          const right3Width = visibleWidth(right3);
          const dimRight3 = theme.fg("dim", right3);
          if (right3Width >= width) {
            lines.push(truncateToWidth(dimRight3, width, theme.fg("dim", "...")));
          } else {
            lines.push(" ".repeat(width - right3Width) + dimRight3);
          }

          return lines;
        },
      };
    });

    // 启动时查询一次余额
    await refreshBalance(false, ctx);
  });

  // 每次对话结束自动刷新余额（静默，不消耗 token）
  pi.on("agent_settled", async (_event, ctx) => {
    await refreshBalance(false, ctx);
  });

  // /balance 命令：查询并显示余额详情
  pi.registerCommand("balance", {
    description: "查询 DeepSeek 账户余额",
    handler: async (_args, ctx) => {
      ctx.ui.notify("正在查询 DeepSeek 余额…", "info");
      await refreshBalance(true, ctx);
    },
  });
}
