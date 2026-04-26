import { FIREBASE_STORAGE_BUCKET } from "@/src/lib/firebase";

type RouteContext = {
  params: Promise<{
    siteId: string;
    path?: string[];
  }>;
};

function buildPublishedUrl(siteId: string, pathSegments?: string[]) {
  const relativePath = pathSegments && pathSegments.length > 0 ? pathSegments.join("/") : "index.html";
  const objectPath = `published-sites/${siteId}/${relativePath}`;
  return `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { siteId, path } = await context.params;
  const upstream = await fetch(buildPublishedUrl(siteId, path), {
    cache: "no-store",
  });

  if (!upstream.ok) {
    return new Response("Site asset not found.", { status: 404 });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "public, max-age=60");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
