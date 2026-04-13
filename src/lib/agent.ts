import { buildSystemPrompt } from "./prompt";
import { executeTool } from "./tools/executor";
import { tools } from "./tools/definitions";
import { getWalletBalances } from "./tools/wallet";
import { getMyPositions } from "./tools/dlmm";
import { log } from "./logger";
import { config } from "./config";
import { getStateSummary } from "./state";
import { getLessonsForPrompt, getPerformanceSummary } from "./lessons";
import { createLLMClient, getDefaultModel, getFallbackModel } from "./llm";
import { getWeightsSummary } from "./signal-weights";
import { getDecisionSummary } from "./decision-log";

const MANAGER_TOOLS = new Set([
  "close_position",
  "claim_fees",
  "swap_token",
  "update_config",
  "get_position_pnl",
  "get_my_positions",
  "set_position_note",
  "add_pool_note",
  "get_wallet_balance",
  "withdraw_liquidity",
  "add_liquidity",
  "list_strategies",
  "get_strategy",
  "set_active_strategy",
  "get_pool_detail",
  "get_token_info",
  "get_active_bin",
  "study_top_lpers",
  "get_recent_decisions",
  "block_deployer",
  "unblock_deployer",
  "list_blocked_deployers",
]);
const SCREENER_TOOLS = new Set([
  "deploy_position",
  "get_active_bin",
  "get_top_candidates",
  "check_smart_wallets_on_pool",
  "get_token_holders",
  "get_token_narrative",
  "get_token_info",
  "search_pools",
  "get_pool_memory",
  "add_pool_note",
  "add_to_blacklist",
  "update_config",
  "get_wallet_balance",
  "get_my_positions",
  "list_strategies",
  "get_strategy",
  "set_active_strategy",
  "swap_token",
  "add_liquidity",
  "study_top_lpers",
  "get_pool_detail",
  "get_recent_decisions",
  "block_deployer",
  "unblock_deployer",
  "list_blocked_deployers",
]);

function getToolsForRole(agentType: string) {
  if (agentType === "MANAGER")
    return tools.filter((t) => MANAGER_TOOLS.has(t.function.name));
  if (agentType === "SCREENER")
    return tools.filter((t) => SCREENER_TOOLS.has(t.function.name));
  return [...tools];
}

const clientPromise = createLLMClient();
const DEFAULT_MODELPromise = getDefaultModel();

export async function agentLoop(
  goal: string,
  maxSteps: number = config.llm.maxSteps,
  sessionHistory: any[] = [],
  agentType: string = "GENERAL",
  model: string | null = null,
  maxOutputTokens: number | null = null,
): Promise<{ content: string; userMessage: string }> {
  const client = await clientPromise;
  const DEFAULT_MODEL = await DEFAULT_MODELPromise;
  const [portfolio, positions] = await Promise.all([
    getWalletBalances(),
    getMyPositions(),
  ]);
  const stateSummary = await getStateSummary();
  const lessons = await getLessonsForPrompt({ agentType });
  const perfSummary = await getPerformanceSummary();

  // Load adaptive intelligence context (non-critical — never block the agent loop)
  let weightsSummary: string | null = null;
  let decisionSummary: string | null = null;
  let goalContext: string | null = null;
  {
    const { getGoalContextForPrompt } = await import("./goals");
    [weightsSummary, decisionSummary, goalContext] = await Promise.all([
      agentType === "SCREENER" && config.darwin?.enabled
        ? getWeightsSummary().catch(() => null)
        : Promise.resolve(null),
      agentType !== "GENERAL"
        ? getDecisionSummary(6).catch(() => null)
        : Promise.resolve(null),
      getGoalContextForPrompt().catch(() => null),
    ]);
  }

  const systemPrompt = buildSystemPrompt(
    agentType,
    portfolio,
    positions,
    stateSummary,
    lessons,
    perfSummary,
    weightsSummary,
    decisionSummary,
    goalContext,
  );

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...sessionHistory,
    { role: "user", content: goal },
  ];

  const FALLBACK_MODEL = await getFallbackModel();

  for (let step = 0; step < maxSteps; step++) {
    log("agent", `Step ${step + 1}/${maxSteps}`);

    try {
      const activeModel = model || DEFAULT_MODEL;
      let response: any;
      let usedModel = activeModel;

      for (let attempt = 0; attempt < 3; attempt++) {
        response = await client.chat({
          model: usedModel,
          messages: messages as any,
          tools: getToolsForRole(agentType) as any,
          stream: false,
          options: {
            temperature: config.llm.temperature,
            num_predict: maxOutputTokens ?? config.llm.maxTokens,
          },
        });
        if (response?.message) break;
        if (attempt === 1 && usedModel !== FALLBACK_MODEL) {
          usedModel = FALLBACK_MODEL;
          log("agent", `Switching to fallback model ${FALLBACK_MODEL}`);
        } else {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        }
      }

      if (!response?.message) throw new Error("LLM returned empty response");
      const msg = response.message;
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        if (!msg.content) {
          messages.pop();
          continue;
        }
        log("agent", "Final answer reached");
        return { content: msg.content, userMessage: goal };
      }

      const toolResults = await Promise.all(
        msg.tool_calls.map(async (toolCall: any) => {
          const toolName = toolCall?.function?.name;
          const rawArgs = toolCall?.function?.arguments;
          const functionArgs =
            typeof rawArgs === "string"
              ? (() => {
                  try {
                    return JSON.parse(rawArgs);
                  } catch {
                    return {};
                  }
                })()
              : rawArgs || {};
          const result = await executeTool(toolName, functionArgs);
          return {
            role: "tool",
            tool_name: toolName,
            content: JSON.stringify(result),
          };
        }),
      );

      messages.push(...toolResults);

      const failedDeploy = toolResults.find((toolResult: any) => {
        if (toolResult?.tool_name !== "deploy_position") return false;
        try {
          const parsed = JSON.parse(toolResult.content);
          return !!(parsed?.error || parsed?.blocked);
        } catch {
          return false;
        }
      });

      if (failedDeploy) {
        let failureReason = "deploy gagal";
        try {
          const parsed = JSON.parse(failedDeploy.content);
          failureReason = parsed?.error || parsed?.reason || failureReason;
        } catch {
          /* keep default */
        }

        log(
          "agent",
          `Stopping follow-up actions after failed deploy: ${failureReason}`,
        );
        return {
          content: `Deploy gagal: ${failureReason}. Tidak ada aksi lanjutan dijalankan.`,
          userMessage: goal,
        };
      }
    } catch (error: any) {
      log("error", `Agent loop error at step ${step}: ${error.message}`);
      if (error.status === 429) {
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      throw error;
    }
  }

  return {
    content: "Max steps reached. Review logs for partial progress.",
    userMessage: goal,
  };
}
