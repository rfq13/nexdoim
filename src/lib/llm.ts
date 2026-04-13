import { Ollama } from "ollama";
import OpenAI from "openai";
import { config, getSecret } from "./config";
import { log } from "./logger";

// ─── Unified response format ─────────────────────────────────

export interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: {
    function: { name: string; arguments: string | Record<string, any> };
  }[];
}

export interface ChatResponse {
  message: ChatMessage;
}

export interface LLMClient {
  chat(params: {
    model: string;
    messages: any[];
    tools?: any[];
    stream: false;
    options?: { temperature?: number; num_predict?: number };
  }): Promise<ChatResponse>;
}

// ─── Provider detection ──────────────────────────────────────

export function getProvider(): "openrouter" | "ollama" {
  return config.llm.provider ?? "ollama";
}

// ─── Ollama client ───────────────────────────────────────────

const DEFAULT_OLLAMA_HOST = "https://ollama.com/api";
const DEFAULT_OLLAMA_MODEL = "gpt-oss:120b";

async function createOllamaRaw(): Promise<Ollama> {
  const host =
    (await getSecret("OLLAMA_HOST")) ||
    process.env.LLM_BASE_URL ||
    DEFAULT_OLLAMA_HOST;
  const apiKey =
    (await getSecret("OLLAMA_API_KEY")) ||
    (await getSecret("LLM_API_KEY")) ||
    (await getSecret("OPENROUTER_API_KEY"));
  return new Ollama({
    host,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
}

function wrapOllama(ollama: Ollama): LLMClient {
  return {
    async chat(params) {
      const res = await ollama.chat({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        stream: false,
        options: {
          temperature: params.options?.temperature,
          num_predict: params.options?.num_predict,
        },
      });
      return { message: res.message as ChatMessage };
    },
  };
}

// ─── OpenRouter client (OpenAI-compatible) ───────────────────

async function createOpenRouterRaw(): Promise<OpenAI> {
  const apiKey =
    (await getSecret("OPENROUTER_API_KEY")) ||
    (await getSecret("LLM_API_KEY")) ||
    process.env.OPENROUTER_API_KEY ||
    "";
  const baseURL =
    (await getSecret("OPENROUTER_BASE_URL")) ||
    process.env.LLM_BASE_URL ||
    "https://openrouter.ai/api/v1";
  return new OpenAI({ apiKey, baseURL });
}

function wrapOpenRouter(client: OpenAI): LLMClient {
  return {
    async chat(params) {
      const res = await client.chat.completions.create({
        model: params.model,
        messages: params.messages,
        tools: params.tools?.map((t: any) => ({
          type: "function" as const,
          function: t.function,
        })),
        temperature: params.options?.temperature,
        max_tokens: params.options?.num_predict,
      });
      const choice = res.choices?.[0];
      if (!choice?.message) {
        return { message: { role: "assistant", content: null } };
      }
      const msg = choice.message;
      return {
        message: {
          role: msg.role,
          content: msg.content,
          tool_calls: msg.tool_calls
            ?.filter(
              (tc): tc is Extract<typeof tc, { type: "function" }> =>
                tc.type === "function",
            )
            .map((tc) => ({
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
        },
      };
    },
  };
}

// ─── Unified factory ─────────────────────────────────────────

let _cachedClient: LLMClient | null = null;
let _cachedProvider: string | null = null;

export async function createLLMClient(): Promise<LLMClient> {
  const provider = getProvider();
  if (_cachedClient && _cachedProvider === provider) return _cachedClient;

  if (provider === "openrouter") {
    const raw = await createOpenRouterRaw();
    _cachedClient = wrapOpenRouter(raw);
  } else {
    const raw = await createOllamaRaw();
    _cachedClient = wrapOllama(raw);
  }
  _cachedProvider = provider;
  log("llm", `LLM client created: ${provider}`);
  return _cachedClient;
}

export function resetLLMClient() {
  _cachedClient = null;
  _cachedProvider = null;
}

// ─── Model helpers ───────────────────────────────────────────

export async function getDefaultModel(): Promise<string> {
  const model = await getSecret("OLLAMA_MODEL");
  return (
    model ||
    process.env.LLM_MODEL ||
    (getProvider() === "openrouter"
      ? "google/gemini-2.5-flash"
      : DEFAULT_OLLAMA_MODEL)
  );
}

export async function getFallbackModel(): Promise<string> {
  const fallback = await getSecret("OLLAMA_FALLBACK_MODEL");
  return (
    fallback ||
    (getProvider() === "openrouter" ? "google/gemini-2.5-flash" : "gpt-oss:20b")
  );
}

const OPENROUTER_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1-nano",
  "deepseek/deepseek-chat-v3",
  "meta-llama/llama-4-maverick",
  "qwen/qwen3-235b-a22b",
  "google/gemma-4-31b-it:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "minimax/minimax-m2.5:free",
  "qwen/qwen3-coder:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
];

export async function getModelCatalogForProvider(
  provider: "ollama" | "openrouter",
): Promise<string[]> {
  const items = new Set<string>();

  if (provider === "ollama") {
    const fromEnv = (process.env.OLLAMA_MODEL_OPTIONS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const model of fromEnv) items.add(model);

    items.add(config.llm.generalModel);
    items.add(config.llm.managementModel);
    items.add(config.llm.screeningModel);

    try {
      const raw = await createOllamaRaw();
      const list = await raw.list();
      for (const m of list.models || []) {
        if (m.model) items.add(m.model);
        if (m.name) items.add(m.name);
      }
    } catch {}
  }

  if (provider === "openrouter") {
    for (const m of OPENROUTER_MODELS) items.add(m);
  }

  return Array.from(items).sort((a, b) => a.localeCompare(b));
}

export async function getModelCatalog(): Promise<string[]> {
  return getModelCatalogForProvider(getProvider());
}

// ─── Legacy exports (backward compat) ────────────────────────

export const createOllamaClient = createLLMClient;
