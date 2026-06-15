import "dotenv/config";
import express from "express";
import { BevoAgent } from "@bevo/agent-sdk";
import type { CommandContext } from "@bevo/agent-sdk";
import { encodeFunctionData } from "viem";
import {
  getLifiQuote,
  fetchTokenDecimals,
  fetchAllowance,
  toAmountRaw,
  formatAmount,
  ERC20_APPROVE_ABI,
  BASE_CHAIN_ID,
} from "./lifi.js";
import { BASE_TOKENS, fetchTopVirtualsTokens, type Token } from "./tokens.js";

// Populated in main() before any request arrives.
// Handler closes over this reference — no stale reads.
let TOKENS: Record<string, Token> = { ...BASE_TOKENS };

const { BEVO_API_KEY, BEVO_API_BASE, PORT, BOT_WALLET } = process.env;
if (!BEVO_API_KEY) throw new Error("BEVO_API_KEY is required — copy .env.example to .env");
if (!BEVO_API_BASE) throw new Error("BEVO_API_BASE is required — copy .env.example to .env");
if (!BOT_WALLET) throw new Error("BOT_WALLET is required — set the bot's EVM wallet address in .env");

const agent = new BevoAgent({ apiKey: BEVO_API_KEY, apiBase: BEVO_API_BASE });

// 1. text
agent.command("text", (ctx) => {
  ctx.reply("Hello from testbot!");
}, { description: "Send a text message" });

// 2. embed
agent.command("embed", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "embed",
    embed: {
      color: "#5865F2",
      title: "Weekly Summary",
      description: "Here is your weekly activity summary.",
      fields: [
        { name: "Messages sent", value: "42", inline: true },
        { name: "Reactions", value: "18", inline: true },
        { name: "Active days", value: "5 / 7", inline: true },
      ],
      footer: { text: "Testbot" },
      timestamp: new Date().toISOString(),
    },
  });
}, { description: "Send an embed message" });

// 3. app_card
agent.command("card", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "app_card",
    card: {
      type: "app_card",
      title: "Bevo App",
      description: "Chat, transact and connect globally.",
      fields: [
        { label: "Status", value: "Active" },
        { label: "Network", value: "Base" },
      ],
      actions: [
        { id: "open", label: "Open", type: "link", url: "https://bevo.chat" },
        { id: "ping", label: "Ping", type: "action", payload: { action: "ping" } },
      ],
    },
  });
}, { description: "Send an app card" });

// 4. components
agent.command("components", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "components",
    content: "Choose an option:",
    components: [
      {
        type: "action_row",
        components: [
          { type: "button", customId: "yes", label: "Yes", style: "success" },
          { type: "button", customId: "no", label: "No", style: "danger" },
          { type: "button", customId: "maybe", label: "Maybe", style: "secondary" },
        ],
      },
      {
        type: "action_row",
        components: [
          {
            type: "select_menu",
            customId: "network_select",
            placeholder: "Select network…",
            options: [
              { label: "Base", value: "base" },
              { label: "Ethereum", value: "ethereum" },
              { label: "Arbitrum", value: "arbitrum" },
            ],
          },
        ],
      },
    ],
  });
}, { description: "Send buttons and a select menu" });

// 5. agent_tip
agent.command("tip", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "agent_tip",
    content: "You can use /all to see every available command.",
  });
}, { description: "Send an agent_tip" });

// 6. agent_info
agent.command("info", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "agent_info",
    content: "Testbot v1.0 — covers all 14 Bevo message wrapper types.",
  });
}, { description: "Send an agent_info" });

// 7. ephemeral
agent.command("ephemeral", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "ephemeral",
    content: "Only you can see this message.",
  });
}, { description: "Send an ephemeral message (only visible to you)" });

// 8. onchain_tx (payment / transfer)
agent.command("payment", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "onchain_tx",
    card: {
      type: "app_card",
      title: "Payment Request",
      description: "Tap Pay to confirm the transfer.",
      fields: [
        { label: "Amount", value: "0.01 USDC" },
        { label: "To", value: "0x0000…1234" },
        { label: "Network", value: "Base" },
      ],
      actions: [
        { id: "pay", label: "Pay 0.01 USDC", type: "action", payload: { action: "pay" } },
      ],
    },
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: 8453,
        // USDC transfer(0x0000…1234, 10000) — 0.01 USDC (6 decimals)
        to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        data: encodeFunctionData({
          abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
          functionName: "transfer",
          args: ["0x0000000000000000000000000000000000001234", 10000n],
        }),
        value: "0x0",
        amount: "0.01",
        currency: "USDC",
        description: "Transfer 0.01 USDC to 0x0000…1234",
      },
    },
  });
}, { description: "Send a payment request for 0.01 USDC" });

// 9. onchain_tx (raw contract call)
agent.command("contract", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "onchain_tx",
    content: "Sign to call approve() on USDC.",
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: 8453,
        // USDC approve(0x0000…1234, 10000) — pre-encoded calldata
        to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        data: encodeFunctionData({
          abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
          functionName: "approve",
          args: ["0x0000000000000000000000000000000000001234", 10000n],
        }),
        value: "0x0",
        description: "Approve 0.01 USDC spend by 0x0000…1234",
      },
    },
  });
}, { description: "Send an onchain_tx contract call (sign to execute)" });

// 10a. onchain_tx + all_butlers — fan-out swap to every group member's butler
agent.command("butler", async (ctx) => {
  if (!ctx.payload.groupId || !ctx.payload.channelId) {
    ctx.reply("This command only works in a group channel.");
    return;
  }
  const d = await ctx.defer();
  await ctx.client.sendMessage({
    groupId: ctx.payload.groupId,
    channelId: ctx.payload.channelId,
    contentType: "onchain_tx",
    content: "Butler wants to swap 0.01 USDC → ETH on your behalf.",
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: 8453,
        tradeParams: {
          tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
          chainIn: 8453,
          amountIn: 0.01,
          tokenOut: "native",
          chainOut: 8453,
        },
        amount: "0.01",
        currency: "USDC",
        description: "Swap 0.01 USDC → ETH",
      },
    },
    targets: "all_butlers",
    signingMode: "butler_auto",
  });
  await d.update("Butler action sent to all group members. Each member's policy will decide auto-execute or approval DM.");
}, { description: "Fan-out an onchain_tx swap to all group members via butler" });

// 10b. onchain_tx + targeted butler — swap for a specific @user
agent.command("butler-one", async (ctx) => {
  if (!ctx.payload.groupId || !ctx.payload.channelId) {
    ctx.reply("This command only works in a group channel.");
    return;
  }
  const userId = ctx.payload.options["user"] as string | undefined;
  const resolved = userId ? ctx.payload.resolved.users[userId] : null;
  if (!resolved) {
    ctx.reply("Usage: /butler-one @user");
    return;
  }
  const d = await ctx.defer();
  await ctx.client.sendMessage({
    groupId: ctx.payload.groupId,
    channelId: ctx.payload.channelId,
    contentType: "onchain_tx",
    content: `Butler wants to swap 0.01 USDC → ETH on behalf of @${resolved.username ?? resolved.principalId}.`,
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: 8453,
        tradeParams: {
          tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
          chainIn: 8453,
          amountIn: 0.01,
          tokenOut: "native",
          chainOut: 8453,
        },
        amount: "0.01",
        currency: "USDC",
        description: "Swap 0.01 USDC → ETH",
      },
    },
    targets: [resolved.principalId],
    signingMode: "butler_or_user",
  });
  await d.update(`Butler action sent to ${resolved.displayName ?? resolved.username ?? resolved.principalId}.`);
}, {
  description: "Fan-out an onchain_tx swap to a specific user via butler",
  options: [{ name: "user", type: "user" as const, description: "Target user", required: true }],
});

// 11. onchain_tx with user_sign — always surfaces a signing prompt to the user
agent.command("approve", async (ctx) => {
  const d = await ctx.defer();
  if (!ctx.payload.groupId || !ctx.payload.channelId) {
    await d.update("This command only works in a group channel.");
    return;
  }
  await ctx.client.sendMessage({
    groupId: ctx.payload.groupId,
    channelId: ctx.payload.channelId,
    contentType: "onchain_tx",
    content: "Testbot requests your signature to approve 0.01 USDC spend.",
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: 8453,
        to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        data: encodeFunctionData({
          abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
          functionName: "approve",
          args: ["0x0000000000000000000000000000000000001234", 10000n],
        }),
        value: "0x0",
        description: "Approve 0.01 USDC spend",
      },
    },
    targets: [ctx.payload.senderId],
    signingMode: "user_sign",
  });
  await d.update("Approval request sent — check your notifications.");
}, { description: "Request user signature via onchain_tx + user_sign" });

// 12. reply
agent.command("reply", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "reply",
    content: "Got it!",
    metadata: {
      replyToMessageId: ctx.payload.messageId,
    },
  });
}, { description: "Send a reply to the triggering message" });

// 13. attachment
agent.command("attachment", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "attachment",
    content: "Here is the report:",
    metadata: {
      attachments: [
        {
          name: "report.pdf",
          url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1",
          mimeType: "application/pdf",
          size: 12345,
        },
      ],
    },
  });
}, { description: "Send an attachment" });

// 14. link_unfurl
agent.command("link", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "link_unfurl",
    content: "https://bevo.chat",
    embed: {
      color: "#00D4AA",
      title: "Bevo — Chat, Transact and Connect globally",
      url: "https://bevo.chat",
      description: "Web3 group-chat, DMs, and mini-apps on one platform.",
      footer: { text: "bevo.chat" },
    },
  });
}, { description: "Send a link unfurl" });

// 15. request — ask a tagged user to pay 0.01 USDC to this bot's wallet
agent.command("request", async (ctx) => {
  const userId = ctx.payload.options["user"] as string | undefined;
  const resolved = userId ? ctx.payload.resolved.users[userId] : null;
  if (!resolved) {
    ctx.reply("Usage: /request @user");
    return;
  }

  // Look up the target user's wallet address
  let targetWallet: string | null = null;
  try {
    const user = await ctx.client.getUser(resolved.principalId);
    targetWallet = user.walletAddress;
  } catch {
    // wallet lookup failed — proceed without showing their address
  }

  const displayName = resolved.displayName ?? resolved.username ?? resolved.principalId;
  const fromField = targetWallet
    ? `${displayName} (${targetWallet.slice(0, 6)}…${targetWallet.slice(-4)})`
    : displayName;

  const d = await ctx.defer();
  // Target the tagged user's butler/signing prompt via sendMessage
  if (!ctx.payload.groupId || !ctx.payload.channelId) {
    await d.update("This command only works in a group channel.");
    return;
  }
  await ctx.client.sendMessage({
    groupId: ctx.payload.groupId,
    channelId: ctx.payload.channelId,
    contentType: "onchain_tx",
    card: {
      type: "app_card",
      title: "Payment Request",
      description: `Requesting 0.01 USDC from ${displayName}.`,
      fields: [
        { label: "Amount", value: "0.01 USDC" },
        { label: "To", value: BOT_WALLET! },
        { label: "From", value: fromField },
        { label: "Network", value: "Base" },
      ],
      actions: [
        { id: "pay", label: "Pay 0.01 USDC", type: "action", payload: { action: "pay" } },
      ],
    },
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: 8453,
        // USDC transfer(BOT_WALLET, 10000) — 0.01 USDC (6 decimals)
        to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        data: encodeFunctionData({
          abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
          functionName: "transfer",
          args: [BOT_WALLET as `0x${string}`, 10000n],
        }),
        value: "0x0",
        amount: "0.01",
        currency: "USDC",
        fromPrincipalId: resolved.principalId,
        description: `Pay 0.01 USDC to testbot`,
      },
    },
    targets: [resolved.principalId],
    signingMode: "butler_or_user",
  });
  await d.update(`Payment request sent to ${displayName}.`);
}, {
  description: "Request 0.01 USDC from a tagged user to this bot's wallet",
  options: [{ name: "user", type: "user" as const, description: "User to request payment from", required: true }],
});

// 16. tradelifi — handler extracted so main() can register it with dynamic choices
async function tradeLifiHandler(ctx: CommandContext): Promise<void> {
  const tokenInKey    = ctx.payload.options["token-in"]   as string | undefined;
  const amountInHuman = ctx.payload.options["amount-in"]  as string | undefined;
  const tokenOutKey   = ctx.payload.options["token-out"]  as string | undefined;

  if (!tokenInKey || !amountInHuman || !tokenOutKey) {
    ctx.reply("Usage: /tradelifi <token-in> <amount-in> <token-out>");
    return;
  }
  const amountNum = Number(amountInHuman);
  if (isNaN(amountNum) || amountNum <= 0) {
    ctx.reply("amount-in must be a positive number.");
    return;
  }

  const d = await ctx.defer();

  type TokenMeta = { address: `0x${string}`; decimals: number; symbol: string };

  // Phase 1 — resolve both tokens + wallet in parallel
  let tokenInMeta: TokenMeta | null = null;
  let tokenOutMeta: TokenMeta | null = null;
  let wallet: `0x${string}` | null = null;
  try {
    // token-in: from user's wallet picker — address comes from resolved.tokens, decimals from our map or on-chain
    const resolvedIn = ctx.payload.resolved.tokens[tokenInKey];
    async function resolveTokenIn(): Promise<TokenMeta | null> {
      if (!resolvedIn) return null;
      const addr = resolvedIn.address as `0x${string}`;
      const known = TOKENS[resolvedIn.symbol];
      if (known) return known;
      const decimals = await fetchTokenDecimals(addr);
      return { address: addr, decimals, symbol: resolvedIn.symbol };
    }

    const [inMeta, user] = await Promise.all([
      resolveTokenIn(),
      ctx.client.getUser(ctx.payload.senderId),
    ]);
    tokenInMeta  = inMeta;
    tokenOutMeta = TOKENS[tokenOutKey] ?? null;
    wallet = user.walletAddress as `0x${string}` | null;
  } catch (err) {
    await d.update(`Could not resolve tokens or wallet: ${(err as Error).message}`);
    return;
  }

  if (!tokenInMeta) {
    await d.update(`Could not resolve "${tokenInKey}" from your wallet — token details missing.`);
    return;
  }
  if (!tokenOutMeta) {
    await d.update(`"${tokenOutKey}" is not a recognised token in our list.`);
    return;
  }
  if (tokenInMeta.address.toLowerCase() === tokenOutMeta.address.toLowerCase()) {
    await d.update("token-in and token-out cannot be the same token.");
    return;
  }
  if (!wallet) {
    await d.update("No wallet found for your account. Please register a wallet first.");
    return;
  }

  let amountInRaw: bigint;
  try {
    amountInRaw = toAmountRaw(amountInHuman, tokenInMeta.decimals);
  } catch {
    await d.update(`Invalid amount "${amountInHuman}" for ${tokenInMeta.symbol} (${tokenInMeta.decimals} decimals).`);
    return;
  }

  // Phase 2 — Li.Fi quote (returns best route + pre-encoded calldata + approval address)
  let quote: Awaited<ReturnType<typeof getLifiQuote>>;
  try {
    quote = await getLifiQuote(tokenInMeta.address, tokenOutMeta.address, amountInRaw, wallet);
  } catch (err) {
    await d.update(`Could not get Li.Fi quote: ${(err as Error).message}`);
    return;
  }

  // Phase 3 — check allowance now that we know approvalAddress
  let allowance = 0n;
  try {
    allowance = await fetchAllowance(tokenInMeta.address, wallet, quote.approvalAddress as `0x${string}`);
  } catch (err) {
    await d.update(`Could not check allowance: ${(err as Error).message}`);
    return;
  }

  const minOutFormatted = formatAmount(quote.toAmountMin, quote.tokenOutDecimals);
  const needsApproval = allowance < amountInRaw;

  await d.updateWith({
    contentType: "onchain_tx",
    card: {
      type: "app_card",
      title: `Swap ${amountInHuman} ${quote.tokenInSymbol} → ${quote.tokenOutSymbol}`,
      description: needsApproval
        ? `⚠ Requires 2 signatures: approve ${quote.tokenInSymbol}, then swap.`
        : `Tap Swap to confirm.`,
      fields: [
        { label: "You receive (min)", value: `${minOutFormatted} ${quote.tokenOutSymbol}` },
        { label: "Route", value: quote.tool },
        { label: "Slippage", value: "0.5%" },
        { label: "Network", value: "Base" },
      ],
      actions: [
        { id: "swap", label: `Swap ${amountInHuman} ${quote.tokenInSymbol}`, type: "action", payload: { action: "swap" } },
      ],
    },
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: BASE_CHAIN_ID,
        // Pre-encoded Li.Fi swap calldata — dispatched as raw calldata (to + data path)
        to: quote.transactionRequest.to,
        data: quote.transactionRequest.data,
        value: quote.transactionRequest.value,
        amount: amountInHuman,
        currency: quote.tokenInSymbol,
        fromPrincipalId: ctx.payload.senderId,
        description: `Swap ${amountInHuman} ${quote.tokenInSymbol} → ${quote.tokenOutSymbol} via Li.Fi (Base)`,
      },
      // If the spender isn't already approved, the client executes this first.
      ...(needsApproval ? {
        approvalRequired: true,
        approvalExecution: {
          type: "onchain_tx",
          chainId: BASE_CHAIN_ID,
          to: tokenInMeta.address,
          data: encodeFunctionData({
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [quote.approvalAddress as `0x${string}`, amountInRaw],
          }),
          value: "0x0",
          description: `Approve ${quote.tokenInSymbol} spend by Li.Fi router`,
        },
      } : {}),
    },
  });
}

// /all — index of every command
agent.command("all", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "embed",
    embed: {
      color: "#FF6B35",
      title: "Testbot — Message Wrapper Commands",
      fields: [
        { name: "/text",       value: "text",             inline: true },
        { name: "/embed",      value: "embed",            inline: true },
        { name: "/card",       value: "app_card",         inline: true },
        { name: "/components", value: "components",       inline: true },
        { name: "/tip",        value: "agent_tip",        inline: true },
        { name: "/info",       value: "agent_info",       inline: true },
        { name: "/ephemeral",  value: "ephemeral",        inline: true },
        { name: "/payment",    value: "onchain_tx (transfer)",        inline: true },
        { name: "/contract",   value: "onchain_tx (calldata)",        inline: true },
        { name: "/butler",     value: "onchain_tx → all_butlers",     inline: true },
        { name: "/butler-one", value: "onchain_tx → @user butler",    inline: true },
        { name: "/approve",    value: "onchain_tx + user_sign",       inline: true },
        { name: "/reply",      value: "reply",            inline: true },
        { name: "/attachment", value: "attachment",       inline: true },
        { name: "/link",       value: "link_unfurl",      inline: true },
        { name: "/request",    value: "onchain_tx → @user (request payment)", inline: true },
        { name: "/tradelifi", value: "onchain_tx → Li.Fi DEX swap",         inline: true },
      ],
    },
  });
}, { description: "List all wrapper commands" });

// ── main: fetch dynamic token list, register tradelifi, start server ─────────
async function main() {
  // Fetch top 30 graduated Virtuals tokens by market cap.
  // BASE_TOKENS take precedence if symbols collide.
  try {
    const virtualsTokens = await fetchTopVirtualsTokens(30);
    TOKENS = { ...virtualsTokens, ...BASE_TOKENS };
    const virtualsCount = Object.keys(virtualsTokens).length;
    console.log(`[testbot] token list: ${Object.keys(TOKENS).length} tokens (${virtualsCount} Virtuals + ${Object.keys(BASE_TOKENS).length} Base)`);
  } catch (err) {
    console.warn("[testbot] Virtuals token fetch failed — using Base-only list:", (err as Error).message);
  }

  // Register tradelifi with the now-populated token list
  agent.command("tradelifi", tradeLifiHandler, {
    description: "Swap tokens via Li.Fi DEX aggregator (Base only)",
    options: [
      { name: "token-in",  type: "token" as const,  description: "Token to sell from your wallet", required: true },
      { name: "amount-in", type: "string" as const,  description: "Amount to sell (e.g. 100)",      required: true },
      { name: "token-out", type: "string" as const,  description: "Token to buy",                   required: true, choices: Object.keys(TOKENS) },
    ],
  });

  const app = express();
  app.use(express.json());
  app.post("/webhook", agent.express());
  app.get("/health", (_req, res) => res.json({ ok: true }));

  const port = Number(PORT ?? 3001);
  app.listen(port, async () => {
    console.log(`[testbot] http://localhost:${port}/webhook`);
    try {
      await agent.syncCommands();
      console.log("[testbot] commands registered ✓");
    } catch (err) {
      console.error("[testbot] failed to register commands:", err);
    }
  });
}

main();
