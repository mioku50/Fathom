# Fathom API Response Schema

This document details the exact JSON structure returned by the core price endpoint (`/v1/price`), including successful response schemas and various error formats.

## Success Response (200 OK)

When a token price is successfully fetched, the API returns a JSON object representing the price, confidence, and liquidity details.

```json
{
  "token": "0x0000000000000000000000000000000000000000",
  "chain": "base",
  "symbol": "PEPECOIN",
  "price_usd": 0.00004217,
  "price_low": 0.00004102,
  "price_high": 0.00004331,
  "twap_5m": 0.00004198,
  "confidence": 73,
  "label": "thin",
  "liquidity_usd": 84200,
  "main_pool": {
    "dex": "aerodrome",
    "address": "0xABC123...",
    "liquidity_usd": 84200,
    "price_usd": 0.00004217,
    "fee": 0.003
  },
  "pools": [
    {
      "dex": "aerodrome",
      "address": "0xABC123...",
      "liquidity_usd": 84200,
      "price_usd": 0.00004217,
      "fee": 0.003
    }
  ],
  "flags": [
    "thin_liquidity"
  ],
  "updated_at": "2024-05-20T14:30:00Z"
}
```

## Error Responses

The API uses standardized HTTP status codes to indicate the success or failure of a request. Below are the common error response formats.

### 400 Bad Request

Returned when the request parameters are invalid, such as a malformed token address.

```json
{
  "error": "invalid_request",
  "message": "Invalid token address format"
}
```

Or for batch requests:

```json
{
  "error": "invalid_request",
  "message": "Invalid token address format: 0xInvalidAddress"
}
```

### 429 Too Many Requests

Returned when the API rate limit has been exceeded.

```json
{
  "error": "rate_limited",
  "message": "Too many requests"
}
```

### 500 Internal Server Error

Returned when the server encounters an unexpected condition, such as failing to read/write to the cache or failing to retrieve cache metrics.

```json
{
  "error": "Internal Server Error: KV not configured"
}
```

```json
{
  "error": "Failed to retrieve cache metrics"
}
```
