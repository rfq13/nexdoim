import { supabase } from "./db";
import { getPerformanceSummary } from "./lessons.js";

export async function generateBriefing(): Promise<string> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: allPositionsData } = await supabase
    .from("positions")
    .select("*");
  const allPositions = allPositionsData ?? [];
  const openedLast24h = allPositions.filter(
    (p: any) => new Date(p.deployed_at) > last24h,
  );
  const closedLast24h = allPositions.filter(
    (p: any) => p.closed && p.closed_at && new Date(p.closed_at) > last24h,
  );

  const { data: perfLast24hData } = await supabase
    .from("performance")
    .select("*")
    .gte("recorded_at", last24h.toISOString());
  const perfLast24h = perfLast24hData ?? [];
  const totalPnlUsd = perfLast24h.reduce(
    (sum: number, row: any) => sum + (row.pnl_usd ?? 0),
    0,
  );
  const totalFeesUsd = perfLast24h.reduce(
    (sum: number, row: any) => sum + (row.fees_earned_usd ?? 0),
    0,
  );

  const { data: lessonsLast24hData } = await supabase
    .from("lessons")
    .select("*")
    .gte("created_at", last24h.toISOString());
  const lessonsLast24h = lessonsLast24hData ?? [];
  const openPositions = allPositions.filter((p: any) => !p.closed);
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
      ? `📈 Win Rate (24h): ${Math.round((perfLast24h.filter((p: any) => (p.pnl_usd ?? 0) > 0).length / perfLast24h.length) * 100)}%`
      : "📈 Win Rate (24h): N/A",
    "",
    "<b>Lessons Learned:</b>",
    lessonsLast24h.length > 0
      ? lessonsLast24h.map((lesson: any) => `• ${lesson.rule}`).join("\n")
      : "• No new lessons recorded overnight.",
    "",
    "<b>Current Portfolio:</b>",
    `📂 Open Positions: ${openPositions.length}`,
    perfSummary
      ? `📊 All-time PnL: $${perfSummary.total_pnl_usd.toFixed(2)} (${perfSummary.win_rate_pct}% win)`
      : "",
    "────────────────",
  ].join("\n");
}
