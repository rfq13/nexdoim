import { supabase } from "./db";
import { getPerformanceSummary } from "./lessons";

export async function generateBriefing(): Promise<string> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: allPositions } = await supabase.from("positions").select("*");
  if (!allPositions) return "No positions found";
  const openedLast24h = allPositions.filter((p: any) => new Date(p.deployed_at) > last24h);
  const closedLast24h = allPositions.filter((p: any) => p.closed && p.closed_at && new Date(p.closed_at) > last24h);
{ data: perfLast24h } = await supabase
    .from("performance")
    .select("*")
    .gte("recorded_at", last24h.toISOString());
  const totalPnlUsd = (perfLast24h ?? []).reduce((s, p: any) => s + (p.pnl_usd ?? 0), 0);
  const { data: lessonsLast24h } = await supabase
    .from("lessons")
    .select("*")
    .gte("created_at", last24h.toISOString());
  const openPositions = (allPositions ?? []).filter((p: anyp) => s + (p.feesEarnedUsd ?? 0), 0);

  const lessonsLast24h = await prisma.lesson.findMany({ where: { createdAt: { gte: last24h } } });
  const openPositions = allPositions.filter((p) => !p.closed);
  const perfSummary = await getPerformanceSummary();

  return [
    "☀️ <b>Morning Briefing</b> (Last 24h)",
    "────────────────",
    "<b>Activity:</b>",
    `📥 Positions Opened: ${openedLast24h.length}`,
    `📤 Positions Closed: ${closedLast24h.length}`,
    "",
    "<b>Performance:</b>",
    `💰 Net PnL: ${totalPnlUsd >= 0 ? "+" : ""}$${totalPnlUsd.toFixed(2)}`,
    `💎 Fees Earned: $${totalFeesUsd.toFixed(2)}`,
    perfLast24h.length > 0
      ? `📈 Win Rate (24h): ${Math.round((perfLast24h.filter((p) => (p.pnlUsd ?? 0) > 0).length / perfLast24h.length) * 100)}%`
      : "📈 Win Rate (24h): N/A",
    "",
    "<b>Lessons Learned:</b>",
    lessonsLast24h.length > 0 ? lessonsLast24h.map((l) => `• ${l.rule}`).join("\n") : "• No new lessons recorded overnight.",
    "",
    "<b>Current Portfolio:</b>",
    `📂 Open Positions: ${openPositions.length}`,
    perfSummary ? `📊 All-time PnL: $${perfSummary.total_pnl_usd.toFixed(2)} (${perfSummary.win_rate_pct}% win)` : "",
    "────────────────",
  ].join("\n");
}
