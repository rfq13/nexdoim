import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import { config } from "../config";
import { log } from "../logger";
import { trackPosition, markOutOfRange, markInRange, recordClaim, recordClose, getTrackedPosition, minutesOutOfRange, syncOpenPositions } from "../state";
import { recordPerformance } from "../lessons";
import { normalizeMint } from "./wallet";
import { getAndClearStagedSignals } from "../signal-tracker";
import { supabase } from "../db";

// ─── Lazy SDK loader ──────────────────────────────────────────
let _DLMM: any = null;
let _StrategyType: any = null;

async function getDLMM() {
  if (!_DLMM) {
    const mod = await import("@meteora-ag/dlmm");
    _DLMM = mod.default;
    _StrategyType = mod.StrategyType;
  }
  return { DLMM: _DLMM, StrategyType: _StrategyType };
}

let _connection: Connection | null = null;
let _wallet: Keypair | null = null;

function getConnection() {
  if (!_connection) _connection = new Connection(process.env.RPC_URL!, "confirmed");
  return _connection;
}

function getWallet() {
  if (!_wallet) {
    if (!process.env.WALLET_PRIVATE_KEY) throw new Error("WALLET_PRIVATE_KEY not set");
    _wallet = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY));
    log("init", `Wallet: ${_wallet.publicKey.toString()}`);
  }
  return _wallet;
}

const poolCache = new Map<string, any>();
async function getPool(poolAddress: string) {
  if (!poolCache.has(poolAddress)) {
    const { DLMM } = await getDLMM();
    poolCache.set(poolAddress, await DLMM.create(getConnection(), new PublicKey(poolAddress)));
  }
  return poolCache.get(poolAddress)!;
}
setInterval(() => poolCache.clear(), 5 * 60 * 1000);

// ─── Get Active Bin ───────────────────────────────────────────
export async function getActiveBin({ pool_address }: { pool_address: string }) {
  pool_address = normalizeMint(pool_address);
  const pool = await getPool(pool_address);
  const activeBin = await pool.getActiveBin();
  return { binId: activeBin.binId, price: pool.fromPricePerLamport(Number(activeBin.price)), pricePerLamport: activeBin.price.toString() };
}

// ─── Deploy Position ──────────────────────────────────────────
export async function deployPosition(args: Record<string, any>) {
  let { pool_address, amount_sol, amount_x, amount_y, strategy, bins_below, bins_above, single_sided_x, pool_name, bin_step, base_fee, volatility, fee_tvl_ratio, organic_score, initial_value_usd } = args;
  pool_address = normalizeMint(pool_address);
  const activeStrategy = strategy || config.strategy.strategy;
  const activeBinsBelow = bins_below ?? config.strategy.binsBelow;
  const activeBinsAbove = bins_above ?? 0;

  if (process.env.DRY_RUN === "true") {
    return { dry_run: true, would_deploy: { pool_address, strategy: activeStrategy, bins_below: activeBinsBelow, bins_above: activeBinsAbove, amount_x: amount_x || 0, amount_y: amount_y || amount_sol || 0 }, message: "DRY RUN" };
  }

  const { StrategyType } = await getDLMM();
  const wallet = getWallet();
  const pool = await getPool(pool_address);
  const activeBin = await pool.getActiveBin();
  const minBinId = activeBin.binId - activeBinsBelow;
  const maxBinId = activeBin.binId + activeBinsAbove;

  const strategyMap: Record<string, any> = { spot: StrategyType.Spot, curve: StrategyType.Curve, bid_ask: StrategyType.BidAsk };
  const strategyType = strategyMap[activeStrategy];
  if (strategyType === undefined) throw new Error(`Invalid strategy: ${activeStrategy}`);

  const finalAmountY = amount_y ?? amount_sol ?? 0;
  const finalAmountX = amount_x ?? 0;
  const totalYLamports = new BN(Math.floor(finalAmountY * 1e9));
  let totalXLamports = new BN(0);
  if (finalAmountX > 0) {
    const mintInfo = await getConnection().getParsedAccountInfo(new PublicKey(pool.lbPair.tokenXMint));
    const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 9;
    totalXLamports = new BN(Math.floor(finalAmountX * Math.pow(10, decimals)));
  }

  const totalBins = activeBinsBelow + activeBinsAbove;
  const isWideRange = totalBins > 69;
  const newPosition = Keypair.generate();

  log("deploy", `Pool: ${pool_address}, Strategy: ${activeStrategy}, Bins: ${minBinId}-${maxBinId}`);

  try {
    const txHashes: string[] = [];

    if (isWideRange) {
      const createTxs = await pool.createExtendedEmptyPosition(minBinId, maxBinId, newPosition.publicKey, wallet.publicKey);
      for (let i = 0; i < (Array.isArray(createTxs) ? createTxs : [createTxs]).length; i++) {
        const tx = (Array.isArray(createTxs) ? createTxs : [createTxs])[i];
        const signers = i === 0 ? [wallet, newPosition] : [wallet];
        txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, signers, { skipPreflight: true }));
      }
      const addTxs = await pool.addLiquidityByStrategyChunkable({
        positionPubKey: newPosition.publicKey, user: wallet.publicKey,
        totalXAmount: totalXLamports, totalYAmount: totalYLamports,
        strategy: { minBinId, maxBinId, strategyType, ...(single_sided_x ? { singleSidedX: true } : {}) },
        slippage: 10,
      });
      for (const tx of Array.isArray(addTxs) ? addTxs : [addTxs]) {
        txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, [wallet], { skipPreflight: true }));
      }
    } else {
      const tx = await pool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPosition.publicKey, user: wallet.publicKey,
        totalXAmount: totalXLamports, totalYAmount: totalYLamports,
        strategy: { maxBinId, minBinId, strategyType, ...(single_sided_x ? { singleSidedX: true } : {}) },
        slippage: 1000,
      });
      txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, [wallet, newPosition], { skipPreflight: true }));
    }

    log("deploy", `SUCCESS — ${txHashes.length} tx(s): ${txHashes[0]}`);
    _positionsCacheAt = 0;

    const trackedStrategy = finalAmountX === 0 && finalAmountY > 0 && activeStrategy === "bid_ask" && activeBinsAbove === 0 ? "single_sided_reseed" : activeStrategy;
    await trackPosition({
      position: newPosition.publicKey.toString(), pool: pool_address, pool_name, strategy: trackedStrategy,
      bin_range: { min: minBinId, max: maxBinId, bins_below: activeBinsBelow, bins_above: activeBinsAbove },
      bin_step, volatility, fee_tvl_ratio, organic_score, amount_sol: finalAmountY, amount_x: finalAmountX,
      active_bin: activeBin.binId, initial_value_usd,
    });

    // Capture and persist signal snapshot for Darwinian learning
    const signalSnapshot = getAndClearStagedSignals(pool_address);
    if (signalSnapshot) {
      supabase.from("positions")
        .update({ signal_snapshot: signalSnapshot })
        .eq("id", newPosition.publicKey.toString())
        .then(({ error }) => {
          if (error) log("signal_tracker", `Failed to save signal_snapshot: ${error.message}`);
        });
    }

    const actualBinStep = pool.lbPair.binStep;
    const activePrice = parseFloat(activeBin.price);
    const minPrice = activePrice * Math.pow(1 + actualBinStep / 10000, minBinId - activeBin.binId);
    const maxPrice = activePrice * Math.pow(1 + actualBinStep / 10000, maxBinId - activeBin.binId);
    const baseFactor = pool.lbPair.parameters?.baseFactor ?? 0;
    const actualBaseFee = base_fee ?? (baseFactor > 0 ? parseFloat((baseFactor * actualBinStep / 1e6 * 100).toFixed(4)) : null);

    return {
      success: true, position: newPosition.publicKey.toString(), pool: pool_address, pool_name,
      bin_range: { min: minBinId, max: maxBinId, active: activeBin.binId },
      price_range: { min: minPrice, max: maxPrice },
      bin_step: actualBinStep, base_fee: actualBaseFee, strategy: activeStrategy, wide_range: isWideRange,
      amount_x: finalAmountX, amount_y: finalAmountY, txs: txHashes,
    };
  } catch (error: any) {
    log("deploy_error", error.message);
    return { success: false, error: error.message };
  }
}

// ─── PnL API ──────────────────────────────────────────────────
async function fetchDlmmPnlForPool(poolAddress: string, walletAddress: string): Promise<Record<string, any>> {
  const url = `https://dlmm.datapi.meteora.ag/positions/${poolAddress}/pnl?user=${walletAddress}&status=open&pageSize=100&page=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    const positions = data.positions || data.data || [];
    const byAddress: Record<string, any> = {};
    for (const p of positions) {
      const addr = p.positionAddress || p.address || p.position;
      if (addr) byAddress[addr] = p;
    }
    return byAddress;
  } catch { return {}; }
}

export async function getPositionPnl({ pool_address, position_address }: { pool_address: string; position_address: string }) {
  pool_address = normalizeMint(pool_address);
  position_address = normalizeMint(position_address);
  try {
    const walletAddress = getWallet().publicKey.toString();
    const byAddress = await fetchDlmmPnlForPool(pool_address, walletAddress);
    const p = byAddress[position_address];
    if (!p) return { error: "Position not found in PnL API" };
    return {
      pnl_usd: Math.round((p.pnlUsd ?? 0) * 100) / 100,
      pnl_pct: Math.round((p.pnlPctChange ?? 0) * 100) / 100,
      current_value_usd: Math.round(parseFloat(p.unrealizedPnl?.balances || 0) * 100) / 100,
      unclaimed_fee_usd: Math.round((parseFloat(p.unrealizedPnl?.unclaimedFeeTokenX?.usd || 0) + parseFloat(p.unrealizedPnl?.unclaimedFeeTokenY?.usd || 0)) * 100) / 100,
      all_time_fees_usd: Math.round(parseFloat(p.allTimeFees?.total?.usd || 0) * 100) / 100,
      fee_per_tvl_24h: Math.round(parseFloat(p.feePerTvl24h || 0) * 100) / 100,
      in_range: !p.isOutOfRange, lower_bin: p.lowerBinId ?? null, upper_bin: p.upperBinId ?? null,
      active_bin: p.poolActiveBinId ?? null,
      age_minutes: p.createdAt ? Math.floor((Date.now() - p.createdAt * 1000) / 60000) : null,
    };
  } catch (error: any) { return { error: error.message }; }
}

// ─── Get My Positions ─────────────────────────────────────────
const POSITIONS_CACHE_TTL = 5 * 60_000;
let _positionsCache: any = null;
let _positionsCacheAt = 0;
let _positionsInflight: Promise<any> | null = null;

export async function getMyPositions({ force = false } = {}): Promise<any> {
  if (!force && _positionsCache && Date.now() - _positionsCacheAt < POSITIONS_CACHE_TTL) return _positionsCache;
  if (_positionsInflight) return _positionsInflight;

  let walletAddress: string;
  try { walletAddress = getWallet().publicKey.toString(); } catch {
    return { wallet: null, total_positions: 0, positions: [], error: "Wallet not configured" };
  }

  _positionsInflight = (async () => {
    try {
      const DLMM_PROGRAM = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
      const accounts = await getConnection().getProgramAccounts(DLMM_PROGRAM, {
        filters: [{ memcmp: { offset: 40, bytes: new PublicKey(walletAddress).toBase58() } }],
      });

      const raw = accounts.map((acc) => {
        const positionAddress = acc.pubkey.toBase58();
        const lbPairKey = new PublicKey(acc.account.data.slice(8, 40)).toBase58();
        return { position: positionAddress, pool: lbPairKey };
      });

      const uniquePools = [...new Set(raw.map((p) => p.pool))];
      const pnlMaps = await Promise.all(uniquePools.map((pool) => fetchDlmmPnlForPool(pool, walletAddress)));
      const pnlByPool: Record<string, any> = {};
      uniquePools.forEach((pool, i) => { pnlByPool[pool] = pnlMaps[i]; });

      const positions = await Promise.all(raw.map(async (r) => {
        const p = pnlByPool[r.pool]?.[r.position] || null;
        const inRange = p ? !p.isOutOfRange : true;
        if (inRange) await markInRange(r.position); else await markOutOfRange(r.position);

        const tracked = await getTrackedPosition(r.position);
        const oor = await minutesOutOfRange(r.position);
        const ageFromPnlApi = p?.createdAt ? Math.floor((Date.now() - p.createdAt * 1000) / 60000) : null;
        const ageFromState = tracked?.deployedAt ? Math.floor((Date.now() - new Date(tracked.deployedAt).getTime()) / 60000) : null;

        return {
          position: r.position, pool: r.pool,
          pair: tracked?.poolName || r.pool.slice(0, 8),
          base_mint: null, lower_bin: p?.lowerBinId ?? null, upper_bin: p?.upperBinId ?? null,
          active_bin: p?.poolActiveBinId ?? null, in_range: inRange,
          unclaimed_fees_usd: Math.round((p ? (parseFloat(p.unrealizedPnl?.unclaimedFeeTokenX?.usd || 0) + parseFloat(p.unrealizedPnl?.unclaimedFeeTokenY?.usd || 0)) : 0) * 100) / 100,
          total_value_usd: Math.round((p ? parseFloat(p.unrealizedPnl?.balances || 0) : 0) * 100) / 100,
          collected_fees_usd: Math.round((p ? parseFloat(p.allTimeFees?.total?.usd || 0) : 0) * 100) / 100,
          pnl_usd: Math.round((p?.pnlUsd ?? 0) * 100) / 100,
          pnl_pct: Math.round((p?.pnlPctChange ?? 0) * 100) / 100,
          age_minutes: Math.max(ageFromPnlApi ?? 0, ageFromState ?? 0) || null,
          minutes_out_of_range: oor,
          instruction: tracked?.instruction ?? null,
        };
      }));

      const result = { wallet: walletAddress, total_positions: positions.length, positions };
      await syncOpenPositions(positions.map((p) => p.position));
      _positionsCache = result;
      _positionsCacheAt = Date.now();
      return result;
    } catch (error: any) {
      log("positions_error", error.message);
      return { wallet: walletAddress, total_positions: 0, positions: [], error: error.message };
    } finally {
      _positionsInflight = null;
    }
  })();
  return _positionsInflight;
}

export async function getWalletPositions({ wallet_address }: { wallet_address: string }) {
  try {
    const DLMM_PROGRAM = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
    const accounts = await getConnection().getProgramAccounts(DLMM_PROGRAM, {
      filters: [{ memcmp: { offset: 40, bytes: new PublicKey(wallet_address).toBase58() } }],
    });
    if (accounts.length === 0) return { wallet: wallet_address, total_positions: 0, positions: [] };

    const raw = accounts.map((acc) => ({ position: acc.pubkey.toBase58(), pool: new PublicKey(acc.account.data.slice(8, 40)).toBase58() }));
    const uniquePools = [...new Set(raw.map((r) => r.pool))];
    const pnlMaps = await Promise.all(uniquePools.map((pool) => fetchDlmmPnlForPool(pool, wallet_address)));
    const pnlByPool: Record<string, any> = {};
    uniquePools.forEach((pool, i) => { pnlByPool[pool] = pnlMaps[i]; });

    const positions = raw.map((r) => {
      const p = pnlByPool[r.pool]?.[r.position] || null;
      return {
        position: r.position, pool: r.pool,
        in_range: p ? !p.isOutOfRange : null,
        unclaimed_fees_usd: Math.round((p ? (parseFloat(p.unrealizedPnl?.unclaimedFeeTokenX?.usd || 0) + parseFloat(p.unrealizedPnl?.unclaimedFeeTokenY?.usd || 0)) : 0) * 100) / 100,
        total_value_usd: Math.round((p ? parseFloat(p.unrealizedPnl?.balances || 0) : 0) * 100) / 100,
        pnl_usd: Math.round((p?.pnlUsd ?? 0) * 100) / 100,
        pnl_pct: Math.round((p?.pnlPctChange ?? 0) * 100) / 100,
      };
    });
    return { wallet: wallet_address, total_positions: positions.length, positions };
  } catch (error: any) {
    return { wallet: wallet_address, total_positions: 0, positions: [], error: error.message };
  }
}

export async function searchPools({ query, limit = 10 }: { query: string; limit?: number }) {
  const res = await fetch(`https://dlmm.datapi.meteora.ag/pools?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Pool search API error: ${res.status}`);
  const data = await res.json();
  const pools = (Array.isArray(data) ? data : data.data || []).slice(0, limit);
  return {
    query, total: pools.length,
    pools: pools.map((p: any) => ({
      pool: p.address || p.pool_address, name: p.name,
      bin_step: p.bin_step ?? p.dlmm_params?.bin_step, fee_pct: p.base_fee_percentage ?? p.fee_pct,
      tvl: p.liquidity, volume_24h: p.trade_volume_24h,
      token_x: { symbol: p.mint_x_symbol ?? p.token_x?.symbol, mint: p.mint_x ?? p.token_x?.address },
      token_y: { symbol: p.mint_y_symbol ?? p.token_y?.symbol, mint: p.mint_y ?? p.token_y?.address },
    })),
  };
}

export async function claimFees({ position_address }: { position_address: string }) {
  position_address = normalizeMint(position_address);
  if (process.env.DRY_RUN === "true") return { dry_run: true, would_claim: position_address };

  try {
    const wallet = getWallet();
    const poolAddress = await lookupPoolForPosition(position_address, wallet.publicKey.toString());
    poolCache.delete(poolAddress);
    const pool = await getPool(poolAddress);
    const positionData = await pool.getPosition(new PublicKey(position_address));
    const txs = await pool.claimSwapFee({ owner: wallet.publicKey, position: positionData });
    if (!txs || txs.length === 0) return { success: false, error: "No fees to claim" };
    const txHashes = [];
    for (const tx of txs) txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, [wallet], { skipPreflight: true }));
    _positionsCacheAt = 0;
    await recordClaim(position_address, 0);
    return { success: true, position: position_address, txs: txHashes, base_mint: pool.lbPair.tokenXMint.toString() };
  } catch (error: any) { return { success: false, error: error.message }; }
}

export async function closePosition({ position_address, skip_swap }: { position_address: string; skip_swap?: boolean }) {
  position_address = normalizeMint(position_address);
  if (process.env.DRY_RUN === "true") return { dry_run: true, would_close: position_address };

  try {
    const wallet = getWallet();
    const poolAddress = await lookupPoolForPosition(position_address, wallet.publicKey.toString());
    poolCache.delete(poolAddress);
    const pool = await getPool(poolAddress);
    const txHashes: string[] = [];

    // Step 1: Claim fees
    try {
      const positionData = await pool.getPosition(new PublicKey(position_address));
      const claimTxs = await pool.claimSwapFee({ owner: wallet.publicKey, position: positionData });
      if (claimTxs?.length > 0) {
        for (const tx of claimTxs) txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, [wallet], { skipPreflight: true }));
      }
    } catch { /* claim may fail */ }

    // Step 2: Remove liquidity & close
    const closeTx = await pool.removeLiquidity({
      user: wallet.publicKey, position: new PublicKey(position_address),
      fromBinId: -887272, toBinId: 887272, bps: new BN(10000), shouldClaimAndClose: true,
    });
    for (const tx of Array.isArray(closeTx) ? closeTx : [closeTx]) {
      txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, [wallet], { skipPreflight: true }));
    }

    await new Promise((r) => setTimeout(r, 5000));
    await recordClose(position_address, "agent decision");

    const tracked = await getTrackedPosition(position_address);
    if (tracked) {
      const minutesHeld = Math.floor((Date.now() - new Date(tracked.deployedAt).getTime()) / 60000);
      let minutesOOR = 0;
      if (tracked.outOfRangeSince) minutesOOR = Math.floor((Date.now() - new Date(tracked.outOfRangeSince).getTime()) / 60000);

      const cachedPos = _positionsCache?.positions?.find((p: any) => p.position === position_address);
      const pnlUsd = cachedPos?.pnl_usd ?? 0;
      const pnlPct = cachedPos?.pnl_pct ?? 0;
      const finalValueUsd = cachedPos?.total_value_usd ?? 0;
      const feesUsd = (cachedPos?.collected_fees_usd || 0) + (cachedPos?.unclaimed_fees_usd || 0);
      let initialUsd = tracked.initialValueUsd || 0;
      if (!initialUsd && tracked.amountSol && tracked.amountSol > 0) initialUsd = finalValueUsd;

      _positionsCacheAt = 0;
      await recordPerformance({
        position: position_address, pool: poolAddress, pool_name: tracked.poolName || undefined,
        strategy: tracked.strategy || undefined, bin_step: tracked.binStep ?? undefined,
        volatility: tracked.volatility ?? undefined, fee_tvl_ratio: tracked.feeTvlRatio ?? undefined,
        organic_score: tracked.organicScore ?? undefined, amount_sol: tracked.amountSol ?? undefined,
        fees_earned_usd: feesUsd, final_value_usd: finalValueUsd, initial_value_usd: initialUsd,
        minutes_in_range: minutesHeld - minutesOOR, minutes_held: minutesHeld, close_reason: "agent decision",
        deployed_at: tracked.deployedAt.toISOString(),
      });

      return { success: true, position: position_address, pool: poolAddress, pool_name: tracked.poolName, txs: txHashes, pnl_usd: pnlUsd, pnl_pct: pnlPct, base_mint: pool.lbPair.tokenXMint.toString() };
    }
    return { success: true, position: position_address, pool: poolAddress, txs: txHashes, base_mint: pool.lbPair.tokenXMint.toString() };
  } catch (error: any) { return { success: false, error: error.message }; }
}

export async function withdrawLiquidity(args: Record<string, any>) {
  let { position_address, pool_address, bps = 10000, claim_fees = true } = args;
  position_address = normalizeMint(position_address);
  if (pool_address) pool_address = normalizeMint(pool_address);
  if (process.env.DRY_RUN === "true") return { dry_run: true, would_withdraw: args };

  try {
    const wallet = getWallet();
    const poolAddr = pool_address || await lookupPoolForPosition(position_address, wallet.publicKey.toString());
    poolCache.delete(poolAddr);
    const pool = await getPool(poolAddr);
    const txHashes: string[] = [];

    if (claim_fees) {
      try {
        const positionData = await pool.getPosition(new PublicKey(position_address));
        const claimTxs = await pool.claimSwapFee({ owner: wallet.publicKey, position: positionData });
        if (claimTxs?.length > 0) for (const tx of claimTxs) txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, [wallet], { skipPreflight: true }));
        await recordClaim(position_address, 0);
      } catch { /* skip */ }
    }

    const withdrawTx = await pool.removeLiquidity({
      user: wallet.publicKey, position: new PublicKey(position_address),
      fromBinId: -887272, toBinId: 887272, bps: new BN(bps), shouldClaimAndClose: false,
    });
    for (const tx of Array.isArray(withdrawTx) ? withdrawTx : [withdrawTx]) {
      txHashes.push(await sendAndConfirmTransaction(getConnection(), tx, [wallet], { skipPreflight: true }));
    }
    _positionsCacheAt = 0;
    return { success: true, position: position_address, pool: poolAddr, bps, txs: txHashes };
  } catch (error: any) { return { success: false, error: error.message }; }
}

export async function addLiquidity(args: Record<string, any>) {
  let { position_address, pool_address, amount_x = 0, amount_y = 0, strategy = "spot", single_sided_x = false } = args;
  position_address = normalizeMint(position_address);
  if (pool_address) pool_address = normalizeMint(pool_address);
  if (process.env.DRY_RUN === "true") return { dry_run: true, would_add: args };

  try {
    const { StrategyType } = await getDLMM();
    const wallet = getWallet();
    const poolAddr = pool_address || await lookupPoolForPosition(position_address, wallet.publicKey.toString());
    const pool = await getPool(poolAddr);
    const positionInfo = await pool.getPosition(new PublicKey(position_address));
    const minBinId = positionInfo.positionData.lowerBinId;
    const maxBinId = positionInfo.positionData.upperBinId;

    const strategyMap: Record<string, any> = { spot: StrategyType.Spot, curve: StrategyType.Curve, bid_ask: StrategyType.BidAsk };
    const strategyType = strategyMap[strategy];
    if (strategyType === undefined) throw new Error(`Invalid strategy: ${strategy}`);

    const totalYLamports = new BN(Math.floor(amount_y * 1e9));
    let totalXLamports = new BN(0);
    if (amount_x > 0) {
      const mintInfo = await getConnection().getParsedAccountInfo(new PublicKey(pool.lbPair.tokenXMint));
      const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 9;
      totalXLamports = new BN(Math.floor(amount_x * Math.pow(10, decimals)));
    }

    const tx = await pool.addLiquidityByStrategy({
      positionPubKey: new PublicKey(position_address), totalXAmount: totalXLamports, totalYAmount: totalYLamports,
      strategy: { maxBinId, minBinId, strategyType, ...(single_sided_x ? { singleSidedX: true } : {}) },
      user: wallet.publicKey, slippage: 100,
    });

    const txHashes: string[] = [];
    for (const t of Array.isArray(tx) ? tx : [tx]) txHashes.push(await sendAndConfirmTransaction(getConnection(), t, [wallet], { skipPreflight: true }));
    _positionsCacheAt = 0;
    return { success: true, position: position_address, pool: poolAddr, added_x: amount_x, added_y: amount_y, strategy, txs: txHashes };
  } catch (error: any) { return { success: false, error: error.message }; }
}

async function lookupPoolForPosition(position_address: string, walletAddress: string): Promise<string> {
  const tracked = await getTrackedPosition(position_address);
  if (tracked?.pool) return tracked.pool;
  const cached = _positionsCache?.positions?.find((p: any) => p.position === position_address);
  if (cached?.pool) return cached.pool;
  const { DLMM } = await getDLMM();
  const allPositions = await DLMM.getAllLbPairPositionsByUser(getConnection(), new PublicKey(walletAddress));
  for (const [lbPairKey, positionData] of Object.entries(allPositions) as any) {
    for (const pos of positionData.lbPairPositionsData || []) {
      if (pos.publicKey.toString() === position_address) return lbPairKey;
    }
  }
  throw new Error(`Position ${position_address} not found`);
}
