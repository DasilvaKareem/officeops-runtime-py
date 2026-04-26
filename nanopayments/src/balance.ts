import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";

const privateKey = process.env.SERVER_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey) {
  console.error("SERVER_PRIVATE_KEY not set in nanopayments/.env");
  process.exit(1);
}

const chain = (process.env.CHAIN ?? "arcTestnet") as "arcTestnet";
const gateway = new GatewayClient({
  chain,
  privateKey
});

const withdrawAmount = process.argv[2];

console.log(`Seller address: ${gateway.address}`);
const balances = await gateway.getBalances();
console.log(`Wallet USDC: ${balances.wallet.formatted}`);
console.log(`Gateway available: ${balances.gateway.formattedAvailable}`);
console.log(`Gateway total: ${balances.gateway.formattedTotal}`);

if (withdrawAmount) {
  console.log(`\nWithdrawing ${withdrawAmount} USDC from Gateway...`);
  const result = await gateway.withdraw(withdrawAmount);
  console.log(`Withdraw tx: ${result.mintTxHash}`);
}
