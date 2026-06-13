import { createPublicClient, http, parseUnits, type Address } from "viem";
import { base } from "viem/chains";

export const BASE_CHAIN_ID = 8453;
const LIFI_API = "https://li.quest/v1";

export const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

export interface LifiQuote {
  tokenInSymbol: string;
  tokenInDecimals: number;
  tokenOutSymbol: string;
  tokenOutDecimals: number;
  /** Expected raw output amount (string to avoid BigInt JSON issues). */
  toAmount: string;
  /** Minimum raw output after slippage (string). */
  toAmountMin: string;
  /** Which DEX/bridge Li.Fi is routing through, e.g. "uniswap-v3". */
  tool: string;
  /** The ERC-20 spender that needs to be approved before the swap. */
  approvalAddress: string;
  transactionRequest: {
    to: string;
    data: string;
    /** ETH value as hex string, e.g. "0x0" for ERC-20 swaps. */
    value: string;
    gasLimit?: string;
  };
}

/**
 * Calls the Li.Fi quote API and returns everything needed to build the
 * approval + swap execution wrappers.
 */
export async function getLifiQuote(
  tokenIn: Address,
  tokenOut: Address,
  amountInRaw: bigint,
  fromAddress: Address,
  slippage = 0.005,
): Promise<LifiQuote> {
  const params = new URLSearchParams({
    fromChain:  String(BASE_CHAIN_ID),
    toChain:    String(BASE_CHAIN_ID),
    fromToken:  tokenIn,
    toToken:    tokenOut,
    fromAmount: amountInRaw.toString(),
    fromAddress,
    slippage:   String(slippage),
  });

  const res = await fetch(`${LIFI_API}/quote?${params}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json() as any;

  if (!res.ok || json.message) {
    throw new Error(json.message ?? `Li.Fi API error ${res.status}`);
  }

  return {
    tokenInSymbol:    json.action.fromToken.symbol  as string,
    tokenInDecimals:  json.action.fromToken.decimals as number,
    tokenOutSymbol:   json.action.toToken.symbol    as string,
    tokenOutDecimals: json.action.toToken.decimals  as number,
    toAmount:         json.estimate.toAmount        as string,
    toAmountMin:      json.estimate.toAmountMin     as string,
    tool:             (json.estimate.tool ?? "unknown") as string,
    // Li.Fi returns approvalAddress at the top level; fall back to the router.
    approvalAddress:  (json.approvalAddress ?? json.transactionRequest.to) as string,
    transactionRequest: {
      to:       json.transactionRequest.to       as string,
      data:     json.transactionRequest.data     as string,
      value:    (json.transactionRequest.value ?? "0x0") as string,
      gasLimit: json.transactionRequest.gasLimit as string | undefined,
    },
  };
}

/** Fetch the tokenIn decimals — needed to convert human-readable amount before calling the API. */
export async function fetchTokenDecimals(address: Address): Promise<number> {
  const decimals = await publicClient.readContract({
    address,
    abi: ERC20_ABI,
    functionName: "decimals",
  });
  return Number(decimals);
}

/** Check current ERC-20 allowance of `spender` over `owner`'s tokens. */
export async function fetchAllowance(
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
}

export function toAmountRaw(amountHuman: string, decimals: number): bigint {
  return parseUnits(amountHuman, decimals);
}

/** Format a raw token amount to a human-readable string with sig figs. */
export function formatAmount(rawAmount: string, decimals: number, sigFigs = 6): string {
  const n = Number(BigInt(rawAmount)) / 10 ** decimals;
  return n.toPrecision(sigFigs);
}

export function isAddress(s: string): s is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}
