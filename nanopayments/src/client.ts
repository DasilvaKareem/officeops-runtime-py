import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";

const privateKey = process.env.CLIENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey) {
  console.error("CLIENT_PRIVATE_KEY not set in nanopayments/.env");
  process.exit(1);
}

const chain = (process.env.CHAIN ?? "arcTestnet") as "arcTestnet";
const gateway = new GatewayClient({
  chain,
  privateKey
});

const promptArg = process.argv.slice(2).join(" ").trim();
const prompt = promptArg || "Draft a short engineering status summary for today.";
const userId = process.env.DEFAULT_USER_ID ?? "test-user";
const floorId = process.env.DEFAULT_FLOOR_ID ?? "7";
const baseUrl = process.env.NANOPAYMENTS_BASE_URL ?? "http://localhost:4021";
const url = `${baseUrl.replace(/\/+$/, "")}/orchestrate?prompt=${encodeURIComponent(prompt)}&userId=${encodeURIComponent(userId)}&floorId=${encodeURIComponent(floorId)}`;

console.log(`Wallet: ${gateway.address}`);
const balances = await gateway.getBalances();
console.log(`Wallet USDC: ${balances.wallet.formatted}`);
console.log(`Gateway available: ${balances.gateway.formattedAvailable}`);
console.log(`Gateway total: ${balances.gateway.formattedTotal}`);

if (balances.gateway.available === 0n) {
  console.error("No Gateway balance. Deposit first: npm run deposit -- 1");
  process.exit(1);
}

console.log(`\nCalling paid endpoint:\n${url}\n`);
try {
  const result = await gateway.pay(url);
  console.log("Nanopayment complete");
  console.log(`Paid: ${result.formattedAmount} USDC`);
  console.log(`Transaction: ${result.transaction}`);
  console.log("Response:");
  console.log(JSON.stringify(result.data, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Payment failed: ${message}`);
  process.exit(1);
}
