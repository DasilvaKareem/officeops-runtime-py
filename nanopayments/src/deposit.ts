import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";

const privateKey = process.env.CLIENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey) {
  console.error("CLIENT_PRIVATE_KEY not set in nanopayments/.env");
  process.exit(1);
}

const amount = process.argv[2];
if (!amount) {
  console.error("Usage: npm run deposit -- <amount>");
  process.exit(1);
}

const chain = (process.env.CHAIN ?? "arcTestnet") as "arcTestnet";
const gateway = new GatewayClient({
  chain,
  privateKey
});

console.log(`Client address: ${gateway.address}`);
const before = await gateway.getBalances();
console.log(`Wallet USDC: ${before.wallet.formatted}`);
console.log(`Gateway available: ${before.gateway.formattedAvailable}`);

console.log(`\nDepositing ${amount} USDC...`);
const result = await gateway.deposit(amount);
console.log(`Deposit complete: ${result.formattedAmount} USDC`);
console.log(`Deposit tx: ${result.depositTxHash}`);
if (result.approvalTxHash) {
  console.log(`Approval tx: ${result.approvalTxHash}`);
}

const after = await gateway.getBalances();
console.log(`Updated Gateway available: ${after.gateway.formattedAvailable}`);
