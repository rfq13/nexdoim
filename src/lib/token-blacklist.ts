import { supabase } from "./db";
import { log } from "./logger";

export async function isBlacklisted(
  mint: string | null | undefined,
): Promise<boolean> {
  if (!mint) return false;
  const { data, error } = await supabase
    .from("token_blacklist")
    .select("mint")
    .eq("mint", mint)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function addToBlacklist({
  mint,
  symbol,
  reason,
}: {
  mint: string;
  symbol?: string;
  reason?: string;
}) {
  if (!mint) return { error: "mint required" };

  const { data: existing, error } = await supabase
    .from("token_blacklist")
    .select("mint,symbol,reason")
    .eq("mint", mint)
    .maybeSingle();

  if (error) throw error;
  if (existing) {
    return {
      already_blacklisted: true,
      mint,
      symbol: existing.symbol,
      reason: existing.reason,
    };
  }

  const { error: insertError } = await supabase.from("token_blacklist").insert({
    mint,
    symbol: symbol ?? "UNKNOWN",
    reason: reason ?? "no reason provided",
  });
  if (insertError) throw insertError;

  log("blacklist", `Blacklisted ${symbol ?? mint}: ${reason}`);
  return { blacklisted: true, mint, symbol, reason };
}

export async function removeFromBlacklist({ mint }: { mint: string }) {
  if (!mint) return { error: "mint required" };

  const { data: entry, error } = await supabase
    .from("token_blacklist")
    .select("*")
    .eq("mint", mint)
    .maybeSingle();

  if (error) throw error;
  if (!entry) return { error: `Mint ${mint} not found on blacklist` };

  const { error: deleteError } = await supabase
    .from("token_blacklist")
    .delete()
    .eq("mint", mint);
  if (deleteError) throw deleteError;

  log("blacklist", `Removed ${entry.symbol} from blacklist`);
  return { removed: true, mint, was: entry };
}

export async function listBlacklist() {
  const { data: entriesData, error } = await supabase
    .from("token_blacklist")
    .select("*");
  if (error) throw error;
  const entries = entriesData ?? [];
  return { count: entries.length, blacklist: entries };
}
