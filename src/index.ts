import "dotenv/config";
import express from "express";
import { BevoAgent } from "@bevo/agent-sdk";
import type { CommandContext } from "@bevo/agent-sdk";
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

// 8. payment_request
agent.command("payment", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "payment_request",
    card: {
      type: "payment_request",
      title: "Payment Request",
      description: "Tap Pay to confirm the transfer.",
      fields: [
        { label: "Amount", value: "0.01 USDC" },
        { label: "To", value: "0x0000…1234" },
        { label: "Network", value: "Base" },
      ],
      actions: [
        {
          id: "pay",
          label: "Pay 0.01 USDC",
          type: "transaction",
          payload: {
            token: "USDC",
            amount: "0.01",
            recipient: "0x0000000000000000000000000000000000001234",
            chainId: 8453,
          },
        },
      ],
    },
    metadata: { executionStatus: "pending_action" },
  });
}, { description: "Send a payment request for 0.01 USDC" });

// 9. contract_call
agent.command("contract", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "contract_call",
    content: "Sign to call approve() on USDC.",
    metadata: {
      executionStatus: "pending_action",
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      chainId: 8453,
      functionName: "approve",
      args: ["0x0000000000000000000000000000000000001234", "10000"],
      abi: [
        {
          name: "approve",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ],
    },
  });
}, { description: "Send a contract_call (sign to execute)" });

// 10a. butler_action — fan-out to ALL group members with a provisioned butler
agent.command("butler", async (ctx) => {
  if (!ctx.payload.groupId || !ctx.payload.channelId) {
    ctx.reply("This command only works in a group channel.");
    return;
  }
  const d = await ctx.defer();
  // sendMessage with targets triggers the server-side fan-out + policy evaluation
  await (ctx.client.sendMessage as Function)({
    groupId: ctx.payload.groupId,
    channelId: ctx.payload.channelId,
    contentType: "butler_action",
    content: "Butler wants to swap 0.01 USDC → ETH on your behalf.",
    metadata: {
      executionStatus: "pending_action",
      execution: {
        type: "butler_action",
        amount: "0.01",
        currency: "USDC",
        description: "Swap 0.01 USDC → ETH",
      },
    },
    targets: "all_butlers", // broadcast to every member with a provisioned butler
  });
  await d.update("Butler action sent to all group members. Each member's policy will decide auto-execute or approval DM.");
}, { description: "Fan-out a butler action to all group members" });

// 10b. butler_action — fan-out to a single @user
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
  await (ctx.client.sendMessage as Function)({
    groupId: ctx.payload.groupId,
    channelId: ctx.payload.channelId,
    contentType: "butler_action",
    content: `Butler wants to swap 0.01 USDC → ETH on behalf of @${resolved.username ?? resolved.principalId}.`,
    metadata: {
      executionStatus: "pending_action",
      execution: {
        type: "butler_action",
        amount: "0.01",
        currency: "USDC",
        description: "Swap 0.01 USDC → ETH",
        toPrincipalId: resolved.principalId,
      },
    },
    targets: [resolved.principalId], // target a single specific user
  });
  await d.update(`Butler action sent to ${resolved.displayName ?? resolved.username ?? resolved.principalId}.`);
}, {
  description: "Fan-out a butler action to a specific user",
  options: [{ name: "user", type: "user" as const, description: "Target user", required: true }],
});

// 11. approval_request
agent.command("approve", async (ctx) => {
  const d = await ctx.defer();
  await d.updateWith({
    contentType: "approval_request",
    content: "Testbot is requesting permission to read your wallet balance.",
    metadata: {
      executionStatus: "pending_action",
      scope: ["wallet.read"],
    },
  });
}, { description: "Send an approval_request" });

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
  await d.updateWith({
    contentType: "payment_request",
    card: {
      type: "payment_request",
      title: "Payment Request",
      description: `Requesting 0.01 USDC from ${displayName}.`,
      fields: [
        { label: "Amount", value: "0.01 USDC" },
        { label: "To", value: BOT_WALLET! },
        { label: "From", value: fromField },
        { label: "Network", value: "Base" },
      ],
      actions: [
        {
          id: "pay",
          label: "Pay 0.01 USDC",
          type: "transaction",
          payload: {
            token: "USDC",
            amount: "0.01",
            recipient: BOT_WALLET,
            chainId: 8453,
          },
        },
      ],
    },
    metadata: { executionStatus: "pending_action" },
  });
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
    contentType: "contract_call",
    card: {
      type: "app_card",
      title: `Swap ${amountInHuman} ${quote.tokenInSymbol} → ${quote.tokenOutSymbol}`,
      description: needsApproval
        ? `Requires 2 signatures: approve ${quote.tokenInSymbol}, then swap. Best route via ${quote.tool}.`
        : `Best route via ${quote.tool} — found by Li.Fi.`,
      fields: [
        { label: "Sell",         value: `${amountInHuman} ${quote.tokenInSymbol}` },
        { label: "Min. receive", value: `${minOutFormatted} ${quote.tokenOutSymbol}` },
        { label: "Slippage",     value: "0.5%" },
        { label: "Route",        value: quote.tool },
        { label: "Network",      value: "Base" },
        ...(needsApproval ? [{ label: "Approval", value: `Required for ${quote.tokenInSymbol}` }] : []),
      ],
    },
    metadata: {
      executionStatus: "pending_action",
      // Primary execution = the swap
      execution: {
        type: "contract_call",
        chainId: BASE_CHAIN_ID,
        contractAddress: quote.transactionRequest.to,
        description: `Swap ${amountInHuman} ${quote.tokenInSymbol} → ${quote.tokenOutSymbol} via Li.Fi (Base)`,
        amount: amountInHuman,
        currency: quote.tokenInSymbol,
        fromPrincipalId: ctx.payload.senderId,
      },
      // Pre-encoded calldata from Li.Fi — client sends this transaction directly.
      transactionRequest: quote.transactionRequest,
      // If approval is needed, client executes this first, then the swap.
      ...(needsApproval ? {
        approvalRequired: true,
        approvalExecution: {
          chainId: BASE_CHAIN_ID,
          contractAddress: tokenInMeta.address,
          functionName: "approve",
          args: [quote.approvalAddress, amountInRaw.toString()],
          abi: ERC20_APPROVE_ABI,
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
        { name: "/payment",    value: "payment_request",  inline: true },
        { name: "/contract",   value: "contract_call",    inline: true },
        { name: "/butler",     value: "butler_action → all",  inline: true },
        { name: "/butler-one", value: "butler_action → @user", inline: true },
        { name: "/approve",    value: "approval_request", inline: true },
        { name: "/reply",      value: "reply",            inline: true },
        { name: "/attachment", value: "attachment",       inline: true },
        { name: "/link",       value: "link_unfurl",      inline: true },
        { name: "/request",    value: "payment_request → @user",       inline: true },
        { name: "/tradelifi", value: "contract_call → Li.Fi DEX swap",  inline: true },
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
      { name: "token-out", type: "string" as const,  description: "Token to buy",                   required: true, choices: Object.keys(BASE_TOKENS) },
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
