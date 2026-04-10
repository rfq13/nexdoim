// Tool schemas in OpenAI format — copied from original definitions.js
// This file is the source of truth for what the LLM can call.

export const tools = [
  // ═══ SCREENING TOOLS ═══
  { type: "function", function: { name: "discover_pools", description: "Fetch top DLMM pools from the Meteora Pool Discovery API. Pre-filtered for safety.", parameters: { type: "object", properties: { page_size: { type: "number" }, timeframe: { type: "string", enum: ["1h", "4h", "12h", "24h"] }, category: { type: "string", enum: ["top", "new", "trending"] } } } } },
  { type: "function", function: { name: "get_top_candidates", description: "Get top pre-scored pool candidates ready for deployment.", parameters: { type: "object", properties: { limit: { type: "number" } } } } },
  { type: "function", function: { name: "get_pool_detail", description: "Get detailed info for a specific DLMM pool by address.", parameters: { type: "object", properties: { pool_address: { type: "string" }, timeframe: { type: "string", enum: ["5m", "15m", "30m", "1h", "2h", "4h", "12h", "24h"] } }, required: ["pool_address"] } } },

  // ═══ POSITION DEPLOYMENT ═══
  { type: "function", function: { name: "get_active_bin", description: "Get the current active bin and price for a DLMM pool.", parameters: { type: "object", properties: { pool_address: { type: "string" } }, required: ["pool_address"] } } },
  { type: "function", function: { name: "deploy_position", description: "Open a new DLMM liquidity position. WARNING: real on-chain transaction.", parameters: { type: "object", properties: { pool_address: { type: "string" }, amount_y: { type: "number" }, amount_x: { type: "number" }, amount_sol: { type: "number" }, strategy: { type: "string", enum: ["bid_ask", "spot"] }, bins_below: { type: "number" }, bins_above: { type: "number" }, pool_name: { type: "string" }, base_mint: { type: "string" }, bin_step: { type: "number" }, base_fee: { type: "number" }, volatility: { type: "number" }, fee_tvl_ratio: { type: "number" }, organic_score: { type: "number" }, initial_value_usd: { type: "number" } }, required: ["pool_address", "initial_value_usd"] } } },

  // ═══ POSITION MANAGEMENT ═══
  { type: "function", function: { name: "get_position_pnl", description: "Get detailed PnL and fee metrics for an open position.", parameters: { type: "object", properties: { pool_address: { type: "string" }, position_address: { type: "string" } }, required: ["pool_address", "position_address"] } } },
  { type: "function", function: { name: "get_my_positions", description: "List all open DLMM positions for the agent wallet.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "claim_fees", description: "Claim accumulated swap fees from a position. WARNING: on-chain tx.", parameters: { type: "object", properties: { position_address: { type: "string" } }, required: ["position_address"] } } },
  { type: "function", function: { name: "close_position", description: "Remove all liquidity and close a position. WARNING: irreversible on-chain tx.", parameters: { type: "object", properties: { position_address: { type: "string" }, skip_swap: { type: "boolean" } }, required: ["position_address"] } } },
  { type: "function", function: { name: "get_wallet_positions", description: "Get all open DLMM positions for any Solana wallet address.", parameters: { type: "object", properties: { wallet_address: { type: "string" } }, required: ["wallet_address"] } } },

  // ═══ WALLET ═══
  { type: "function", function: { name: "get_wallet_balance", description: "Get current wallet balances for SOL, tokens, total USD.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "swap_token", description: "Swap tokens via Jupiter aggregator. WARNING: on-chain tx.", parameters: { type: "object", properties: { input_mint: { type: "string" }, output_mint: { type: "string" }, amount: { type: "number" } }, required: ["input_mint", "output_mint", "amount"] } } },

  // ═══ CONFIG ═══
  { type: "function", function: { name: "update_config", description: "Update operating parameters at runtime. Changes persist to DB.", parameters: { type: "object", properties: { changes: { type: "object" }, reason: { type: "string" } }, required: ["changes"] } } },

  // ═══ SMART WALLETS ═══
  { type: "function", function: { name: "add_smart_wallet", description: "Add a wallet to the smart wallet tracker.", parameters: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, category: { type: "string", enum: ["alpha", "smart", "fast", "multi"] }, type: { type: "string", enum: ["lp", "holder"] } }, required: ["name", "address"] } } },
  { type: "function", function: { name: "remove_smart_wallet", description: "Remove a wallet from smart wallet tracker.", parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] } } },
  { type: "function", function: { name: "list_smart_wallets", description: "List all tracked smart wallets.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "check_smart_wallets_on_pool", description: "Check if tracked smart wallets have positions in a pool.", parameters: { type: "object", properties: { pool_address: { type: "string" } }, required: ["pool_address"] } } },

  // ═══ TOKEN INFO ═══
  { type: "function", function: { name: "get_token_info", description: "Get token data from Jupiter (organic score, holders, audit, stats).", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "get_token_holders", description: "Get holder distribution for a token by mint address.", parameters: { type: "object", properties: { mint: { type: "string" }, limit: { type: "number" } }, required: ["mint"] } } },
  { type: "function", function: { name: "get_token_narrative", description: "Get the narrative/story behind a token from Jupiter ChainInsight.", parameters: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } } },
  { type: "function", function: { name: "search_pools", description: "Search for DLMM pools by token symbol or contract address.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } } },

  // ═══ STUDY ═══
  { type: "function", function: { name: "get_top_lpers", description: "Get top LPers for a pool — quick read-only.", parameters: { type: "object", properties: { pool_address: { type: "string" }, limit: { type: "number" } }, required: ["pool_address"] } } },
  { type: "function", function: { name: "study_top_lpers", description: "Study top LPers behaviour for learning.", parameters: { type: "object", properties: { pool_address: { type: "string" }, limit: { type: "number" } }, required: ["pool_address"] } } },

  // ═══ LESSONS ═══
  { type: "function", function: { name: "add_lesson", description: "Save a lesson to permanent memory.", parameters: { type: "object", properties: { rule: { type: "string" }, tags: { type: "array", items: { type: "string" } }, role: { type: "string", enum: ["SCREENER", "MANAGER", "GENERAL"] }, pinned: { type: "boolean" } }, required: ["rule"] } } },
  { type: "function", function: { name: "list_lessons", description: "Browse saved lessons with optional filters.", parameters: { type: "object", properties: { role: { type: "string" }, pinned: { type: "boolean" }, tag: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "pin_lesson", description: "Pin a lesson by ID.", parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } } },
  { type: "function", function: { name: "unpin_lesson", description: "Unpin a lesson.", parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } } },
  { type: "function", function: { name: "clear_lessons", description: "Remove lessons from memory.", parameters: { type: "object", properties: { mode: { type: "string", enum: ["keyword", "all", "performance"] }, keyword: { type: "string" } }, required: ["mode"] } } },
  { type: "function", function: { name: "set_position_note", description: "Save a persistent instruction for a position.", parameters: { type: "object", properties: { position_address: { type: "string" }, instruction: { type: "string" } }, required: ["position_address", "instruction"] } } },
  { type: "function", function: { name: "get_performance_history", description: "Retrieve closed position records.", parameters: { type: "object", properties: { hours: { type: "number" }, limit: { type: "number" } } } } },

  // ═══ STRATEGY ═══
  { type: "function", function: { name: "add_strategy", description: "Save a new LP strategy.", parameters: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, author: { type: "string" }, lp_strategy: { type: "string", enum: ["bid_ask", "spot", "curve"] }, token_criteria: { type: "object" }, entry: { type: "object" }, range: { type: "object" }, exit: { type: "object" }, best_for: { type: "string" }, raw: { type: "string" } }, required: ["id", "name"] } } },
  { type: "function", function: { name: "list_strategies", description: "List all saved strategies.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_strategy", description: "Get full details of a strategy.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "set_active_strategy", description: "Set which strategy to use for next cycle.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "remove_strategy", description: "Remove a strategy.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },

  // ═══ POOL MEMORY ═══
  { type: "function", function: { name: "get_pool_memory", description: "Check deploy history for a pool.", parameters: { type: "object", properties: { pool_address: { type: "string" } }, required: ["pool_address"] } } },
  { type: "function", function: { name: "add_pool_note", description: "Annotate a pool with a freeform note.", parameters: { type: "object", properties: { pool_address: { type: "string" }, note: { type: "string" } }, required: ["pool_address", "note"] } } },

  // ═══ BLACKLIST ═══
  { type: "function", function: { name: "add_to_blacklist", description: "Permanently blacklist a token mint.", parameters: { type: "object", properties: { mint: { type: "string" }, symbol: { type: "string" }, reason: { type: "string" } }, required: ["mint", "reason"] } } },
  { type: "function", function: { name: "remove_from_blacklist", description: "Remove a token from blacklist.", parameters: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } } },
  { type: "function", function: { name: "list_blacklist", description: "List all blacklisted tokens.", parameters: { type: "object", properties: {} } } },

  // ═══ LIQUIDITY MANAGEMENT ═══
  { type: "function", function: { name: "withdraw_liquidity", description: "Remove partial/full liquidity from a position without closing it.", parameters: { type: "object", properties: { position_address: { type: "string" }, pool_address: { type: "string" }, bps: { type: "number" }, claim_fees: { type: "boolean" } }, required: ["position_address", "pool_address"] } } },
  { type: "function", function: { name: "add_liquidity", description: "Add tokens to an existing position.", parameters: { type: "object", properties: { position_address: { type: "string" }, pool_address: { type: "string" }, amount_x: { type: "number" }, amount_y: { type: "number" }, strategy: { type: "string", enum: ["spot", "curve", "bid_ask"] } }, required: ["position_address", "pool_address"] } } },

  // ═══ INTELLIGENCE & SAFETY ═══
  { type: "function", function: { name: "get_recent_decisions", description: "Retrieve recent agent decisions (deploy, skip, close) with reasons and risks. Use to avoid repeating past mistakes.", parameters: { type: "object", properties: { limit: { type: "number", description: "Number of decisions to retrieve (default 6, max 20)" } } } } },
  { type: "function", function: { name: "block_deployer", description: "Permanently block a token deployer/developer wallet. Future pools from this dev will be filtered before reaching the LLM.", parameters: { type: "object", properties: { address: { type: "string", description: "Deployer wallet address to block" }, reason: { type: "string", description: "Why this deployer is being blocked" } }, required: ["address"] } } },
  { type: "function", function: { name: "unblock_deployer", description: "Remove a developer wallet from the block list.", parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] } } },
  { type: "function", function: { name: "list_blocked_deployers", description: "List all blocked developer/deployer wallets.", parameters: { type: "object", properties: {} } } },
] as const;
