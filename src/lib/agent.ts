import OpenAI from "openai";
import { buildSystemPrompt } from "./prompt";
import { executeTool } from "./tools/executor";
import { tools } from "./tools/definitions";
import { getWalletBalances } from "./tools/wallet";
import { getMyPositions } from "./tools/dlmm";
import { log } from "./logger";
import { config } from "./config";
import { getStateSummary } from "./state";
import { getLessonsForPrompt, getPerformanceSummary } from "./lessons";

const MANAGER_TOOLS = new Set(["close_position", "claim_fees", "swap_token", "update_config", "get_position_pnl", "get_my_positions", "set_position_note", "add_pool_note", "get_wallet_balance", "withdraw_liquidity", "add_liquidity", "list_strategies", "get_strategy", "set_active_strategy", "get_pool_detail", "get_token_info", "get_active_bin", "study_top_lpers"]);
const SCREENER_TOOLS = new Set(["deploy_position", "get_active_bin", "get_top_candidates", "check_smart_wallets_on_pool", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "get_pool_memory", "add_pool_note", "add_to_blacklist", "update_config", "get_wallet_balance", "get_my_positions", "list_strategies", "get_strategy", "set_active_strategy", "swap_token", "add_liquidity", "study_top_lpers", "get_pool_detail"]);

function getToolsForRole(agentType: string) {
  if (agentType === "MANAGER") return tools.filter((t) => MANAGER_TOOLS.has(t.function.name));
  if (agentType === "SCREENER") return tools.filter((t) => SCREENER_TOOLS.has(t.function.name));
  return [...tools];
}

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY,
  timeout: 5 * 60 * 1000,
});

const DEFAULT_MODEL = process.env.LLM_MODEL || "openrouter/healer-alpha";

export async function agentLoop(
  goal: string,
  maxSteps: number = config.llm.maxSteps,
  sessionHistory: any[] = [],
  agentType: string = "GENERAL",
  model: string | null = null,
  maxOutputTokens: number | null = null
): Promise<{ content: string; userMessage: string }> {
  const [portfolio, positions] = await Promise.all([getWalletBalances(), getMyPositions()]);
  const stateSummary = await getStateSummary();
  const lessons = await getLessonsForPrompt({ agentType });
  const perfSummary = await getPerformanceSummary();
  const systemPrompt = buildSystemPrompt(agentType, portfolio, positions, stateSummary, lessons, perfSummary);

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...sessionHistory,
    { role: "user", content: goal },
  ];

  const FALLBACK_MODEL = "stepfun/step-3.5-flash:free";

  for (let step = 0; step < maxSteps; step++) {
    log("agent", `Step ${step + 1}/${maxSteps}`);

    try {
      const activeModel = model || DEFAULT_MODEL;
      let response: any;
      let usedModel = activeModel;

      for (let attempt = 0; attempt < 3; attempt++) {
        response = await client.chat.completions.create({
          model: usedModel,
          messages,
          tools: getToolsForRole(agentType) as any,
          tool_choice: "auto",
          temperature: config.llm.temperature,
          max_tokens: maxOutputTokens ?? config.llm.maxTokens,
        });
        if (response.choices?.length) break;
        const errCode = response.error?.code;
        if (errCode === 502 || errCode === 503 || errCode === 529) {
          if (attempt === 1 && usedModel !== FALLBACK_MODEL) {
            usedModel = FALLBACK_MODEL;
            log("agent", `Switching to fallback model ${FALLBACK_MODEL}`);
          } else {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
          }
        } else break;
      }

      if (!response.choices?.length) throw new Error(`API returned no choices`);
      const msg = response.choices[0].message;
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        if (!msg.content) { messages.pop(); continue; }
        log("agent", "Final answer reached");
        return { content: msg.content, userMessage: goal };
      }

      const toolResults = await Promise.all(msg.tool_calls.map(async (toolCall: any) => {
        let functionArgs;
        try { functionArgs = JSON.parse(toolCall.function.arguments); } catch { functionArgs = {}; }
        const result = await executeTool(toolCall.function.name, functionArgs);
        return { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) };
      }));
      messages.push(...toolResults);
    } catch (error: any) {
      log("error", `Agent loop error at step ${step}: ${error.message}`);
      if (error.status === 429) { await new Promise((r) => setTimeout(r, 30000)); continue; }
      throw error;
    }
  }

  return { content: "Max steps reached. Review logs for partial progress.", userMessage: goal };
}
