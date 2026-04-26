import "dotenv/config";
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

const serverAddress = process.env.SERVER_ADDRESS;
if (!serverAddress) {
  console.error("SERVER_ADDRESS not set in nanopayments/.env");
  process.exit(1);
}

const runtimeBase = (process.env.RUNTIME_BASE_URL ?? "http://localhost:3002").replace(/\/+$/, "");
const price = process.env.NANOPAYMENT_PRICE ?? "$0.01";

const app = express();
const gateway = createGatewayMiddleware({ sellerAddress: serverAddress });

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Paid route that forwards to existing Python runtime orchestrator.
app.get("/orchestrate", gateway.require(price), async (req, res) => {
  const promptRaw = req.query.prompt;
  const userIdRaw = req.query.userId;
  const floorIdRaw = req.query.floorId;

  const prompt = typeof promptRaw === "string" ? promptRaw.trim() : "";
  const userId = typeof userIdRaw === "string" ? userIdRaw.trim() : process.env.DEFAULT_USER_ID ?? "test-user";
  const floorId = Number(typeof floorIdRaw === "string" ? floorIdRaw : process.env.DEFAULT_FLOOR_ID ?? "7");

  if (!prompt) {
    res.status(400).json({ error: "Missing query param: prompt" });
    return;
  }

  try {
    const upstream = await fetch(`${runtimeBase}/api/orchestrate-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        prompt,
        requirement: prompt,
        userId,
        floorId
      })
    });

    const json = await upstream.json();
    res.status(upstream.status).json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: `Runtime proxy failed: ${message}` });
  }
});

const port = Number(process.env.NANOPAYMENTS_PORT ?? 4021);
app.listen(port, () => {
  console.log(`Nanopayment server on http://localhost:${port}`);
  console.log(`Paid endpoint: GET /orchestrate?prompt=... -> ${price}`);
  console.log(`Runtime proxy: ${runtimeBase}/api/orchestrate-sync`);
  console.log(`Seller address: ${serverAddress}`);
});
