import "dotenv/config";
import express from "express";
import { BevoAgent } from "../../bevo-agent-sdk/src/index.js";

const { BEVO_API_KEY, BEVO_API_BASE, PORT } = process.env;
if (!BEVO_API_KEY) throw new Error("BEVO_API_KEY is required — copy .env.example to .env");
if (!BEVO_API_BASE) throw new Error("BEVO_API_BASE is required — copy .env.example to .env");

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
      ],
    },
  });
}, { description: "List all wrapper commands" });

// ── server ────────────────────────────────────────────────────────────────────
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
