export const priceInputSchema = {
  type: "object",
  properties: {
    token: {
      type: "string",
      description: "Base ERC-20 token address",
      pattern: "^0x[a-fA-F0-9]{40}$"
    },
    chain: {
      type: "string",
      const: "base",
      default: "base"
    }
  },
  required: ["token"],

};

export const priceOutputSchema = {
  type: "object",
  properties: {
    token: { type: "string" },
    chain: { type: "string" },
    symbol: { type: "string" },
    price_usd: { type: "number" },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "How much this price can be trusted, 0-100. See `flags` for the reasons behind a low score."
    },
    label: { type: "string", enum: ["reliable", "thin / volatile", "unreliable"] },
    liquidity_usd: {
      type: ["number", "null"],
      description: "Parked liquidity in the main pool. Null for concentrated-liquidity pools, where the on-chain figure is an active-range parameter rather than a balance - use sell_quotes there."
    },
    source_count: {
      type: "number",
      description: "Independent pools deep enough to count as a price source. 1 means single-venue."
    },
    price_dispersion_bps: {
      type: ["number", "null"],
      description: "Spread between independent sources in basis points; null when there are fewer than 2 sources."
    },
    measured_weight: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Share of the confidence model actually backed by a measurement, 0-1. `confidence` is computed only over the components that were measured, so this says how much evidence stands behind it: 1.0 is the whole model, 0.35 is a score derived from barely a third of it. Below 0.5 the response cannot be labelled reliable and carries `low_measurement_coverage`."
    },
    confidence_components: {
      type: "object",
      description: "Per-component breakdown of `confidence`. A component with score null was not measured and its weight was redistributed across the ones that were.",
      properties: {
        liquidity: {
      type: "object",
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 1 },
        weight: { type: "number" },
        effective_weight: { type: "number" }
      },
      required: ["score", "weight", "effective_weight"]
    },
        execution_quality: {
      type: "object",
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 1 },
        weight: { type: "number" },
        effective_weight: { type: "number" }
      },
      required: ["score", "weight", "effective_weight"]
    },
        source_agreement: {
      type: "object",
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 1 },
        weight: { type: "number" },
        effective_weight: { type: "number" }
      },
      required: ["score", "weight", "effective_weight"]
    },
        twap_deviation: {
      type: "object",
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 1 },
        weight: { type: "number" },
        effective_weight: { type: "number" }
      },
      required: ["score", "weight", "effective_weight"]
    },
        volatility: {
      type: "object",
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 1 },
        weight: { type: "number" },
        effective_weight: { type: "number" }
      },
      required: ["score", "weight", "effective_weight"]
    },
        maturity: {
      type: "object",
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 1 },
        weight: { type: "number" },
        effective_weight: { type: "number" }
      },
      required: ["score", "weight", "effective_weight"]
    }
      }
    },
    twap: {
      type: "object",
      description: "Time-weighted average price from the main pool's own oracle. Null when the pool cannot answer - commonly a fresh pool whose observation cardinality is still 1.",
      properties: {
        price_usd: { type: ["number", "null"] },
        window_seconds: { type: ["number", "null"], description: "The window actually averaged over, which may differ per DEX." },
        spot_deviation_bps: { type: ["number", "null"], description: "How far spot sits from the average, in basis points." }
      },
      required: ["price_usd", "window_seconds", "spot_deviation_bps"]
    },
    sell_quotes: {
      type: "array",
      description: "What selling this notional actually returns on the main pool, fees and slippage included. Null fields mean the pool's curve needs a quoter we do not call yet.",
      items: {
        type: "object",
        properties: {
          size_usd: { type: "number" },
          proceeds_usd: { type: ["number", "null"] },
          execution_price_usd: { type: ["number", "null"] },
          price_impact_bps: { type: ["number", "null"] }
        },
        required: ["size_usd", "proceeds_usd", "execution_price_usd", "price_impact_bps"]
      }
    },
    depth_1pct_usd: {
      type: ["number", "null"],
      description: "Notional that moves the main pool's marginal price by 1%."
    },
    depth_5pct_usd: {
      type: ["number", "null"],
      description: "Notional that moves the main pool's marginal price by 5%."
    },
    main_pool: {
      type: "object",
      properties: {
        dex: { type: "string" },
        address: { type: "string" },
        fee: { type: "number" },
        liquidity_usd: { type: "number" },
        price_usd: { type: "number" }
      },
      required: ["dex", "address", "price_usd"]
    },
    flags: {
      type: "array",
      items: { type: "string" },
      description: "Risk markers, in two kinds. Measurements about the token: `thin_liquidity`, `no_exit_liquidity` (the largest advertised sale cannot be filled), `possible_manipulation`, `single_pool`, `stale`, `unsellable`. Limits of what could be established: `twap_unavailable`, `freshness_unchecked`, `sellability_unchecked`, `depth_unavailable`, `liquidity_unmeasured`, `low_measurement_coverage` (under half the confidence model was measured), `no_measurable_signal` (none of it was), `incomplete_pool_coverage` (most discovered pools could not be read, so no verdict about the market is offered), `exit_liquidity_unverified` (exit was not established rather than found absent), `hardcoded_numeraire` (USDC, whose value is defined rather than measured). Never infer a token is bad from the second kind."
    },
    updated_at: { type: "string", format: "date-time" },
    status: { type: "string", enum: ["ok", "not_found", "no_liquidity", "rpc_error", "unpriceable", "stale_anchor", "unknown_decimals"] },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" }
      }
    }
  },
  required: ["token", "chain", "status"]
};

export const pricesInputSchema = {
  type: "object",
  properties: {
    tokens: {
      type: "string",
      description: "Comma-separated list of 1 to 50 Base ERC-20 token addresses",
      examples: [
        "0x940181a94A35A4569E4529A3CDfB74e38FD98631,0x4200000000000000000000000000000000000006"
      ]
    },
    chain: {
      type: "string",
      const: "base",
      default: "base"
    }
  },
  required: ["tokens"],

};

export const pricesOutputSchema = {
  type: "object",
  properties: {
    chain: { type: "string" },
    count: { type: "number" },
    priced: { type: "number" },
    failed: { type: "number" },
    results: {
      type: "array",
      items: priceOutputSchema
    }
  },
  required: ["chain", "count", "priced", "failed", "results"]
};

export const metadataInputSchema = {
  type: "object",
  properties: {
    token: {
      type: "string",
      description: "Base ERC-20 token address",
      pattern: "^0x[a-fA-F0-9]{40}$"
    },
    chain: {
      type: "string",
      const: "base",
      default: "base"
    }
  },
  required: ["token"],

};

export const metadataOutputSchema = {
  type: "object",
  properties: {
    address: { type: "string" },
    symbol: { type: "string" },
    name: { type: "string" },
    decimals: { type: "number" }
  },
  required: ["address", "symbol", "name", "decimals"]
};

export const metadatasInputSchema = {
  type: "object",
  properties: {
    tokens: {
      type: "string",
      description: "Comma-separated list of Base ERC-20 token addresses"
    },
    chain: {
      type: "string",
      const: "base",
      default: "base"
    }
  },
  required: ["tokens"],

};

export const metadatasOutputSchema = {
  type: "object",
  properties: {
    chain: { type: "string" },
    count: { type: "number" },
    results: {
      type: "array",
      items: metadataOutputSchema
    }
  },
  required: ["chain", "count", "results"]
};
