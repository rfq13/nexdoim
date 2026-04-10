import { Ollama } from "ollama";
import { config, getSecret } from "./config";

const DEFAULT_OLLAMA_HOST = "https://ollama.com/api";
const DEFAULT_OLLAMA_MODEL = "gpt-oss:120b";

export async function getOllamaHost(): Promise<string> {
  const host = await getSecret("OLLAMA_HOST");
  return host || process.env.LLM_BASE_URL || DEFAULT_OLLAMA_HOST;
}

export async function getDefaultModel(): Promise<string> {
  const model = await getSecret("OLLAMA_MODEL");
  return model || process.env.LLM_MODEL || DEFAULT_OLLAMA_MODEL;
}

export async function getFallbackModel(): Promise<string> {
  const fallback = await getSecret("OLLAMA_FALLBACK_MODEL");
  return fallback || "gpt-oss:20b";
}

export async function createOllamaClient(): Promise<Ollama> {
  const host = await getOllamaHost();
  const apiKey =
    (await getSecret("OLLAMA_API_KEY")) ||
    (await getSecret("LLM_API_KEY")) ||
    (await getSecret("OPENROUTER_API_KEY"));

  return new Ollama({
    host,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
}

export async function getModelCatalog(): Promise<string[]> {
  const items = new Set<string>();

  const fromEnv = (process.env.OLLAMA_MODEL_OPTIONS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  for (const model of fromEnv) items.add(model);

  items.add(await getDefaultModel());
  items.add(await getFallbackModel());
  items.add(config.llm.generalModel);
  items.add(config.llm.managementModel);
  items.add(config.llm.screeningModel);

  try {
    const client = await createOllamaClient();
    const list = await client.list();
    for (const m of list.models || []) {
      if (m.model) items.add(m.model);
      if (m.name) items.add(m.name);
    }
  } catch {
    // Keep fallback list when model listing is unavailable.
  }

  return Array.from(items).sort((a, b) => a.localeCompare(b));
}
