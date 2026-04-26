import { NextRequest } from "next/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  prompt?: string;
  userId?: string;
  floorId?: number;
  buyerPrivateKey?: string;
};

function getBaseUrl() {
  return (process.env.ORCHESTRATOR_URL || "http://localhost:3002").replace(/\/+$/, "");
}

function getChain() {
  return (process.env.NANOPAYMENTS_CHAIN || "arcTestnet") as "arcTestnet";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const floorId = typeof body.floorId === "number" ? body.floorId : 7;
    const buyerPrivateKey = typeof body.buyerPrivateKey === "string" ? body.buyerPrivateKey.trim() : "";

    if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
    if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });
    if (!buyerPrivateKey.startsWith("0x")) {
      return Response.json({ error: "buyerPrivateKey must be a 0x private key" }, { status: 400 });
    }

    const gateway = new GatewayClient({
      chain: getChain(),
      privateKey: buyerPrivateKey as `0x${string}`,
    });
    const buyerAccount = privateKeyToAccount(buyerPrivateKey as `0x${string}`);

    const endpoint = `${getBaseUrl()}/api/orchestrate-paid`;
    const paid = await gateway.pay(endpoint, {
      method: "POST",
      body: {
        prompt,
        requirement: prompt,
        userId,
        floorId,
        expectedPayerAddress: buyerAccount.address,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    return Response.json({
      ok: true,
      transaction: paid.transaction,
      amount: paid.formattedAmount,
      data: paid.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
