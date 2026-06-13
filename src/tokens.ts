import type { Address } from "viem";

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

/** Verified popular ERC-20 tokens on Base mainnet (chainId 8453). */
export const BASE_TOKENS: Record<string, Token> = {
  // ── Stablecoins ────────────────────────────────────────────────────────────
  USDC:    { symbol: "USDC",    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6  },
  USDT:    { symbol: "USDT",    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6  },
  DAI:     { symbol: "DAI",     address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  EURC:    { symbol: "EURC",    address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1aDb42", decimals: 6  },
  // ── ETH / BTC ──────────────────────────────────────────────────────────────
  WETH:    { symbol: "WETH",    address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  cbETH:   { symbol: "cbETH",   address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
  wstETH:  { symbol: "wstETH",  address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", decimals: 18 },
  weETH:   { symbol: "weETH",   address: "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150a", decimals: 18 },
  cbBTC:   { symbol: "cbBTC",   address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8  },
  rETH:    { symbol: "rETH",    address: "0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c", decimals: 18 },
  // ── DeFi / Protocol ────────────────────────────────────────────────────────
  AERO:    { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
  VIRTUAL: { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", decimals: 18 },
  COMP:    { symbol: "COMP",    address: "0x9e1028F5F1D5eDE59748FFceE5532509976840E0", decimals: 18 },
  UNI:     { symbol: "UNI",     address: "0xc3De830EA07524a0761646a6a4e4be0e114a3C83", decimals: 18 },
  AAVE:    { symbol: "AAVE",    address: "0x63706e401c06Ac8513145b7687A14804d17f814b", decimals: 18 },
  // ── Meme / Community ───────────────────────────────────────────────────────
  DEGEN:   { symbol: "DEGEN",   address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18 },
  BRETT:   { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18 },
  TOSHI:   { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", decimals: 18 },
  higher:  { symbol: "higher",  address: "0x0578d8A44db98B23BF096A382e016e29a5ce0FFE", decimals: 18 },
  // ── AI / Virtuals (pinned top token) ───────────────────────────────────────
  AIXBT:   { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", decimals: 18 },
};

/**
 * Fetches the top N graduated Virtuals Protocol agent tokens sorted by
 * market cap. All Virtuals agent tokens use 18 decimals (hardcoded in
 * their bonding curve factory). Returns {} on any failure.
 */
export async function fetchTopVirtualsTokens(n = 30): Promise<Record<string, Token>> {
  // Build query string manually — URLSearchParams encodes brackets which
  // Strapi does not accept.
  const query =
    `filters[status][$eq]=2` +
    `&sort[0]=mcapInVirtual:desc` +
    `&pagination[pageSize]=${n}` +
    `&pagination[page]=1`;

  const res = await fetch(`https://api.virtuals.io/api/virtuals?${query}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Virtuals API responded with ${res.status}`);

  const json = await res.json() as { data?: Array<Record<string, unknown>> };
  const tokens: Record<string, Token> = {};

  for (const item of json.data ?? []) {
    const symbol  = item["symbol"]       as string | undefined;
    const address = item["tokenAddress"] as string | undefined;
    if (!symbol || !address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    tokens[symbol] = { symbol, address: address as Address, decimals: 18 };
  }

  return tokens;
}
