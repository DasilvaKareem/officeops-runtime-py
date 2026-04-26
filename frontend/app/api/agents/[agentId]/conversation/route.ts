import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    agentId: string;
  }>;
};

function getOrchestratorBase() {
  return (
    process.env.ORCHESTRATOR_URL
    || "https://officeops-runtime-py-1077255576315.us-central1.run.app"
  ).replace(/\/+$/, "");
}

function jsonError(message: string, status = 502) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { agentId } = await context.params;
  const userId = request.nextUrl.searchParams.get("user_id");
  const limit = request.nextUrl.searchParams.get("limit");
  if (!userId) return jsonError("Missing required query parameter: user_id", 400);

  const params = new URLSearchParams({ user_id: userId });
  if (limit) params.set("limit", limit);
  const upstreamUrl = `${getOrchestratorBase()}/api/agents/${encodeURIComponent(agentId)}/conversation?${params.toString()}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: { "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`Conversation proxy GET failed: ${message}`);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { agentId } = await context.params;
  const upstreamUrl = `${getOrchestratorBase()}/api/agents/${encodeURIComponent(agentId)}/conversation`;

  try {
    const body = await request.text();
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: { "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`Conversation proxy POST failed: ${message}`);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { agentId } = await context.params;
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) return jsonError("Missing required query parameter: user_id", 400);

  const upstreamUrl = `${getOrchestratorBase()}/api/agents/${encodeURIComponent(agentId)}/conversation?user_id=${encodeURIComponent(userId)}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "DELETE",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: { "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`Conversation proxy DELETE failed: ${message}`);
  }
}
