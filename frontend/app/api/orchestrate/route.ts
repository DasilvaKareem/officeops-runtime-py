import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getOrchestratorBase() {
  return (
    process.env.ORCHESTRATOR_URL
    || "https://officeops-runtime-py-1077255576315.us-central1.run.app"
  ).replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  const upstreamUrl = `${getOrchestratorBase()}/api/orchestrate`;

  try {
    const body = await request.text();
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
      },
      body,
      cache: "no-store",
    });

    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");

    if (!upstream.body) {
      const text = await upstream.text().catch(() => "");
      return new Response(text, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: `Orchestrator proxy failed: ${message}` }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
