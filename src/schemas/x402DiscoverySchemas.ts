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
  additionalProperties: false
};

export const priceOutputSchema = {
  type: "object",
  properties: {
    token: { type: "string" },
    chain: { type: "string" },
    symbol: { type: "string" },
    price_usd: { type: "number" },
    price_low: { type: "number" },
    price_high: { type: "number" },
    twap_5m: { type: "number" },
    confidence: { type: "number" },
    label: { type: "string" },
    liquidity_usd: { type: "number" },
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
      items: { type: "string" }
    },
    updated_at: { type: "string", format: "date-time" },
    status: { type: "string", enum: ["ok", "not_found", "no_liquidity", "rpc_error", "unpriceable"] },
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
  additionalProperties: false
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
  additionalProperties: false
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
  additionalProperties: false
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
