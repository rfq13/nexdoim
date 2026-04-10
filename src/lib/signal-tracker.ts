/**
 * In-memory signal staging for Darwinian learning.
 *
 * During screening enrichment, signals (organic_score, fee_tvl_ratio, etc.)
 * are staged per pool address. When a position is deployed, the staged
 * signals are captured and saved to the positions table as signal_snapshot
 * for later post-hoc analysis when the position closes.
 *
 * The staging Map lives in module scope — safe because the cron's
 * _screeningBusy mutex prevents concurrent screening cycles.
 */

export type SignalSnapshot = Partial<Record<string, number | boolean | string | null>>;

const _staged = new Map<string, SignalSnapshot>();

export function stageSignals(poolAddress: string, signals: SignalSnapshot): void {
  _staged.set(poolAddress, { ..._staged.get(poolAddress), ...signals });
}

export function getAndClearStagedSignals(poolAddress: string): SignalSnapshot | null {
  const snapshot = _staged.get(poolAddress) ?? null;
  _staged.delete(poolAddress);
  return snapshot;
}

export function getStagedPools(): string[] {
  return [..._staged.keys()];
}
