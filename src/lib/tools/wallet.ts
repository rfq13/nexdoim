import { Connection, PublicKey, VersionedTransaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { log } from "../logger";
import { config, getSecret } from "../config";

let _connection: Connection | null = null;
let _wallet: Keypair | null = null;

async function getConnection() {
  if (!_connection) {
    const rpcUrl = await getSecret("RPC_URL") || process.env.RPC_URL;
    if (!rpcUrl) throw new Error("RPC_URL not set");
    _connection = new Connection(rpcUrl, "confirmed");
  }
  return _connection;
}

async function getWallet() {
  if (!_wallet) {
    const pk = await getSecret("WALLET_PRIVATE_KEY") || process.env.WALLET_PRIVATE_KEY;
    if (!pk) throw new Error("WALLET_PRIVATE_KEY not set");
    _wallet = Keypair.fromSecretKey(bs58.decode(pk));
  }
  return _wallet;
}

const JUPITER_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUPITER_QUOTE_API = "https://api.jup.ag/swap/v1";
const JUPITER_API_KEY = "b15d42e9-e0e4-4f90-a424-ae41ceeaa382";

export function normalizeMint(mint: string | undefined | null): string {
  if (!mint) return "";
  const aliases: Record<string, string> = { SOL: config.tokens.SOL, USDC: config.tokens.USDC, USDT: config.tokens.USDT };
  return aliases[mint.toUpperCase()] || mint.trim();
}

export async function getWalletBalances() {
  // Debug: test raw getSecret to surface real errors
  const rawPk = await getSecret("WALLET_PRIVATE_KEY").catch(() => undefined) || process.env.WALLET_PRIVATE_KEY;
  if (!rawPk) {
    return { wallet: null, sol: 0, sol_price: 0, sol_usd: 0, usdc: 0, tokens: [], total_usd: 0, error: "WALLET_PRIVATE_KEY tidak ditemukan di secrets maupun env" };
  }

  let walletAddress: string;
  let wallet: Keypair;
  try {
    wallet = Keypair.fromSecretKey(bs58.decode(rawPk));
    walletAddress = wallet.publicKey.toString();
    // Invalidate cached wallet if secret changed
    if (_wallet && _wallet.publicKey.toString() !== walletAddress) {
      _wallet = null;
      _connection = null;
    }
    _wallet = wallet;
  } catch (e: any) {
    return { wallet: null, sol: 0, sol_price: 0, sol_usd: 0, usdc: 0, tokens: [], total_usd: 0, error: `Invalid private key format: ${e.message}` };
  }

  // Always fetch SOL balance directly via RPC — no Helius needed
  let solLamports = 0;
  try {
    const conn = await getConnection();
    solLamports = await conn.getBalance(wallet.publicKey);
  } catch (e: any) {
    return { wallet: walletAddress, sol: 0, sol_price: 0, sol_usd: 0, usdc: 0, tokens: [], total_usd: 0, error: `RPC error: ${e.message}` };
  }
  const solBalance = Math.round(solLamports / 1e9 * 1e6) / 1e6;

  // Try Helius for enriched data (token balances + USD price) — optional
  const HELIUS_KEY = await getSecret("HELIUS_API_KEY") || process.env.HELIUS_API_KEY;
  if (HELIUS_KEY) {
    try {
      const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${HELIUS_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const nativeBalance = data.nativeBalance ?? solLamports;
        const tokens: any[] = data.tokens ?? [];

        const solPrice = await fetchSolPrice().catch(() => 0);
        const solUsd = Math.round((nativeBalance / 1e9) * solPrice * 100) / 100;

        const usdcEntry = tokens.find((t: any) => t.mint === config.tokens.USDC);

        return {
          wallet: walletAddress,
          sol: Math.round(nativeBalance / 1e9 * 1e6) / 1e6,
          sol_price: Math.round(solPrice * 100) / 100,
          sol_usd: solUsd,
          usdc: Math.round((usdcEntry?.amount / 1e6 || 0) * 100) / 100,
          tokens: tokens.map((t: any) => ({
            mint: t.mint,
            symbol: t.tokenAccount || t.mint?.slice(0, 8),
            balance: t.amount / Math.pow(10, t.decimals ?? 9),
            usd: null,
          })),
          total_usd: solUsd,
        };
      }
    } catch { /* fall through to basic result */ }
  }

  // Fallback: only SOL from RPC, no token data
  const solPrice = await fetchSolPrice().catch(() => 0);
  return {
    wallet: walletAddress,
    sol: solBalance,
    sol_price: Math.round(solPrice * 100) / 100,
    sol_usd: Math.round(solBalance * solPrice * 100) / 100,
    usdc: 0,
    tokens: [],
    total_usd: Math.round(solBalance * solPrice * 100) / 100,
  };
}

async function fetchSolPrice(): Promise<number> {
  const res = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return 0;
  const data = await res.json();
  return parseFloat(data?.data?.["So11111111111111111111111111111111111111112"]?.price ?? "0");
}

export async function swapToken({ input_mint, output_mint, amount }: { input_mint: string; output_mint: string; amount: number }) {
  input_mint = normalizeMint(input_mint);
  output_mint = normalizeMint(output_mint);

  const dryRun = await getSecret("DRY_RUN") || process.env.DRY_RUN;
  if (dryRun === "true") {
    return { dry_run: true, would_swap: { input_mint, output_mint, amount }, message: "DRY RUN" };
  }

  try {
    const wallet = await getWallet();
    const connection = await getConnection();

    let decimals = 9;
    if (input_mint !== config.tokens.SOL) {
      const mintInfo = await connection.getParsedAccountInfo(new PublicKey(input_mint));
      decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 9;
    }
    const amountStr = Math.floor(amount * Math.pow(10, decimals)).toString();

    // Try Ultra API first
    const orderUrl = `${JUPITER_ULTRA_API}/order?inputMint=${input_mint}&outputMint=${output_mint}&amount=${amountStr}&taker=${wallet.publicKey.toString()}`;
    const orderRes = await fetch(orderUrl, { headers: { "x-api-key": JUPITER_API_KEY } });

    if (!orderRes.ok || orderRes.status === 500) {
      return await swapViaQuoteApi({ wallet, connection, input_mint, output_mint, amountStr });
    }

    const order = await orderRes.json();
    if (order.errorCode) return await swapViaQuoteApi({ wallet, connection, input_mint, output_mint, amountStr });

    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
    tx.sign([wallet]);
    const signedTx = Buffer.from(tx.serialize()).toString("base64");

    const execRes = await fetch(`${JUPITER_ULTRA_API}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": JUPITER_API_KEY },
      body: JSON.stringify({ signedTransaction: signedTx, requestId: order.requestId }),
    });
    if (!execRes.ok) throw new Error(`Ultra execute failed: ${execRes.status}`);
    const result = await execRes.json();
    if (result.status === "Failed") throw new Error(`Swap failed on-chain: code=${result.code}`);

    log("swap", `SUCCESS tx: ${result.signature}`);
    return { success: true, tx: result.signature, input_mint, output_mint, amount_in: result.inputAmountResult, amount_out: result.outputAmountResult };
  } catch (error: any) {
    log("swap_error", error.message);
    return { success: false, error: error.message };
  }
}

async function swapViaQuoteApi({ wallet, connection, input_mint, output_mint, amountStr }: any) {
  const quoteRes = await fetch(`${JUPITER_QUOTE_API}/quote?inputMint=${input_mint}&outputMint=${output_mint}&amount=${amountStr}&slippageBps=300`, { headers: { "x-api-key": JUPITER_API_KEY } });
  if (!quoteRes.ok) throw new Error(`Quote failed: ${quoteRes.status}`);
  const quote = await quoteRes.json();

  const swapRes = await fetch(`${JUPITER_QUOTE_API}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": JUPITER_API_KEY },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: wallet.publicKey.toString(), wrapAndUnwrapSol: true }),
  });
  if (!swapRes.ok) throw new Error(`Swap tx failed: ${swapRes.status}`);
  const { swapTransaction } = await swapRes.json();

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([wallet]);
  const txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(txHash, "confirmed");

  log("swap", `SUCCESS (fallback) tx: ${txHash}`);
  return { success: true, tx: txHash, input_mint, output_mint };
}
