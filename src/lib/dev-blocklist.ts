/**
 * Dev (deployer) blocklist — deployer wallet addresses that should never
 * be deployed into. Screening hard-filters any pool whose base token was
 * deployed by a blocked wallet before the list reaches the LLM.
 */

import { supabase } from "./db";
import { log } from "./logger";

export async function blockDev(args: { address: string; reason?: string }): Promise<{ blocked?: boolean; already_blocked?: boolean; error?: string; address?: string; reason?: string }> {
  const { address, reason } = args;
  if (!address) return { error: "address required" };

  const { data: existing } = await supabase
    .from("dev_blocklist")
    .select("address")
    .eq("address", address)
    .maybeSingle();

  if (existing) return { already_blocked: true, address };

  const { error } = await supabase.from("dev_blocklist").insert({
    address,
    reason: reason || "no reason provided",
  });

  if (error) throw error;
  log("dev_blocklist", `Blocked deployer ${address}: ${reason}`);
  return { blocked: true, address, reason: reason || "no reason provided" };
}

export async function unblockDev(args: { address: string }): Promise<{ unblocked?: boolean; error?: string; address?: string }> {
  const { address } = args;
  if (!address) return { error: "address required" };

  const { data: existing } = await supabase
    .from("dev_blocklist")
    .select("address")
    .eq("address", address)
    .maybeSingle();

  if (!existing) return { error: `Address ${address} not on dev blocklist` };

  const { error } = await supabase
    .from("dev_blocklist")
    .delete()
    .eq("address", address);

  if (error) throw error;
  log("dev_blocklist", `Removed deployer ${address} from blocklist`);
  return { unblocked: true, address };
}

export async function listBlockedDevs(): Promise<{ count: number; blocked_devs: any[] }> {
  const { data, error } = await supabase
    .from("dev_blocklist")
    .select("*")
    .order("added_at", { ascending: false });

  if (error) throw error;
  return { count: (data ?? []).length, blocked_devs: data ?? [] };
}

export async function isDevBlocked(address: string | null | undefined): Promise<boolean> {
  if (!address) return false;
  const { data } = await supabase
    .from("dev_blocklist")
    .select("address")
    .eq("address", address)
    .maybeSingle();
  return !!data;
}
