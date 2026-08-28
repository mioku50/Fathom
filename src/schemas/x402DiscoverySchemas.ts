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
    liquidity_usd: { type: "number" },
    source_count: {
      type: "number",
      description: "Independent pools deep enough to count as a price source. 1 means single-venue."
    },
    price_dispersion_bps: {
      type: ["number", "null"],
      description: "Spread between independent sources in basis points; null when there are fewer than 2 sources."
    },
    confidence_components: {
      type: "object",
      description: "Per-component breakdown of `confidence`. A component with score null was not measured and its weight was redistributed.",
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
      required: ["dex", "address", "liquidity_usd", "price_usd"]
    },
    flags: {
      type: "array",
      items: { type: "string" },
      description: "Risk markers. `twap_unavailable`, `freshness_unchecked`, `sellability_unchecked` and `depth_unavailable` mean the corresponding check did not run."
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
