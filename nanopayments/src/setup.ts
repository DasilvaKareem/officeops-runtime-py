import "dotenv/config";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const clientPrivateKey = generatePrivateKey();
const serverPrivateKey = generatePrivateKey();

const client = privateKeyToAccount(clientPrivateKey);
const server = privateKeyToAccount(serverPrivateKey);

console.log("Add these to nanopayments/.env");
console.log(`CLIENT_PRIVATE_KEY=${clientPrivateKey}`);
console.log(`SERVER_PRIVATE_KEY=${serverPrivateKey}`);
console.log(`SERVER_ADDRESS=${server.address}`);
console.log("");
console.log(`Client address: ${client.address}`);
console.log(`Server address: ${server.address}`);
