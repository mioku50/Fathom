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

export const assessInputSchema = {
  type: "object",
  properties: {
    token: {
      type: "string",
      pattern: "^0x[a-fA-F0-9]{40}$",
      description: "Base ERC-20 token address"
    },
    size_usd: {
      type: "number",
      minimum: 1,
      maximum: 10000000,
      default: 10000,
      description: "The sale you are contemplating, in USD. Quoted on chain at exactly this size rather than interpolated between standard sizes. Pass the position you actually hold."
    },
    chain: { type: "string", enum: ["base"], default: "base" }
  },
  required: ["token"],
  additionalProperties: false
};

export const assessOutputSchema = {
  type: "object",
  properties: {
    token: { type: "string" },
    chain: { type: "string" },
    symbol: { type: "string" },
    price_usd: { type: "number" },
    verdict: {
      type: "string",
      enum: ["tradeable", "caution", "illiquid", "unverified"],
      description: "The single field to branch on. `tradeable`: the sale fills cheaply against a corroborated price. `caution`: it fills, at a cost worth knowing. `illiquid`: it cannot be filled, or costs over a tenth of the position. `unverified`: too little could be measured to say - retry rather than treating this as a negative."
    },
    reason: {
      type: "string",
      description: "One sentence saying why, for an agent's trace and for a human reading it."
    },
    size_usd: { type: "number", description: "The sale this verdict is about." },
    exit: {
      type: "object",
      description: "What the requested sale actually returns, quoted on chain.",
      properties: {
        fillable: {
          type: ["boolean", "null"],
          description: "true if the sale fills, false if measured and it cannot, null if never established. The last is not a negative."
        },
        proceeds_usd: { type: ["number", "null"] },
        price_impact_bps: { type: ["number", "null"], description: "Shortfall of the realised price against spot." },
        execution_price_usd: { type: ["number", "null"] }
      },
      required: ["fillable", "proceeds_usd", "price_impact_bps", "execution_price_usd"]
    },
    price_trust: {
      type: "object",
      description: "How well corroborated the price behind that quote is.",
      properties: {
        confidence: { type: "number", minimum: 0, maximum: 100 },
        measured_weight: { type: "number", minimum: 0, maximum: 1, description: "Share of the confidence model actually measured." },
        sources: { type: "number", description: "Independent pools that agreed." },
        dispersion_bps: { type: ["number", "null"] },
        twap_deviation_bps: { type: ["number", "null"] }
      },
      required: ["confidence", "measured_weight", "sources", "dispersion_bps", "twap_deviation_bps"]
    },
    concerns: {
      type: "array",
      items: { type: "string" },
      description: "Measured facts about the token that argue against trading it. Act on these."
    },
    unverified: {
      type: "array",
      items: { type: "string" },
      description: "Checks that did not run. Never evidence against the token - a failure to look is not a finding."
    },
    updated_at: { type: "string", format: "date-time" }
  },
  required: ["token", "chain", "verdict", "reason", "size_usd", "exit", "price_trust"]
};
