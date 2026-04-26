"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/src/lib/firebase";
import {
  ROOT_NODE_ID,
  createFolder,
  deleteNode,
  getNode,
  listChildren,
  publishWebsiteFolder,
  renameNode,
  uploadUserFile,
  type FsNode,
} from "@/src/lib/filesystem";
import { FileViewerModal } from "./FileViewerModal";

function kindIcon(node: FsNode) {
  if (node.type === "folder") return "📁";
  if (node.kind === "photo") return "🖼️";
  if (node.kind === "video") return "🎬";
  if (node.kind === "music") return "🎵";
  if (node.kind === "code") return "💻";
  return "📄";
}

export function FileExplorer() {
  const [userId, setUserId] = useState<string | null>(null);
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<FsNode[]>([]);
  const [nodes, setNodes] = useState<FsNode[]>([]);
  const [folderName, setFolderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingNode, setViewingNode] = useState<FsNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid ?? null);
      setCurrentParentId(null);
      setNodes([]);
      setBreadcrumbs([]);
    });
  }, []);

  const refresh = async (uid: string, parentId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const [children, trail] = await Promise.all([
        listChildren(uid, parentId),
        buildBreadcrumbs(uid, parentId),
      ]);
      setNodes(children);
      setBreadcrumbs(trail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => {
      void refresh(userId, currentParentId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId, currentParentId]);

  const pathLabel = useMemo(() => {
    if (breadcrumbs.length === 0) return "Home";
    return ["Home", ...breadcrumbs.map((node) => node.name)].join(" / ");
  }, [breadcrumbs]);

  const handleCreateFolder = async () => {
    if (!userId || !folderName.trim()) return;
    try {
      await createFolder(userId, currentParentId, folderName.trim());
      setFolderName("");
      await refresh(userId, currentParentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder.");
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!userId || !files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await Promise.all([...files].map((file) => uploadUserFile(userId, currentParentId, file)));
      await refresh(userId, currentParentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRename = async (node: FsNode) => {
    if (!userId) return;
    const nextName = window.prompt("Rename item", node.name)?.trim();
    if (!nextName || nextName === node.name) return;
    try {
      await renameNode(userId, node.id, nextName);
      await refresh(userId, currentParentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed.");
    }
  };

  const handleDelete = async (node: FsNode) => {
    if (!userId) return;
    if (!window.confirm(`Delete "${node.name}"?`)) return;
    try {
      await deleteNode(userId, node);
      await refresh(userId, currentParentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const handlePublish = async (node: FsNode) => {
    if (!userId || node.type !== "folder") return;
    setPublishingId(node.id);
    setError(null);
    try {
      const site = await publishWebsiteFolder(userId, node.id);
      window.open(site.urlPath, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishingId(null);
    }
  };

  const openNode = (node: FsNode) => {
    if (node.type === "folder") {
      setCurrentParentId(node.id);
      return;
    }
    if (node.downloadURL) {
      setViewingNode(node);
    }
  };

  if (!userId) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-950/85 p-3">
        <p className="font-semibold text-white">Personal Files</p>
        <p className="mt-2 text-sm text-slate-400">Log in to access your private filesystem.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-white/10 bg-slate-950/85 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-white">Personal Files</p>
            <p className="text-xs text-slate-400">{pathLabel}</p>
          </div>
          <button
            onClick={() => setCurrentParentId(null)}
            className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300"
          >
            Root
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="New folder"
            className="h-9 flex-1 rounded-lg border border-white/15 bg-slate-900/70 px-3 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!folderName.trim()}
            className="rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => void handleUpload(e.target.files)}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-200 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
          {currentParentId ? (
            <button
              onClick={() => {
                const parent = breadcrumbs[breadcrumbs.length - 1]?.parentId ?? null;
                setCurrentParentId(parent);
              }}
              className="rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-300"
            >
              Up
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {error}
          </div>
        ) : null}

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : nodes.length === 0 ? (
            <p className="text-sm text-slate-500">This folder is empty.</p>
          ) : (
            nodes.map((node) => (
              <div key={node.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/70 px-2 py-2">
                <button onClick={() => openNode(node)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm text-white">
                    <span className="mr-2">{kindIcon(node)}</span>
                    {node.name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {node.type === "folder"
                      ? "Folder"
                      : `${node.kind ?? "file"}${typeof node.size === "number" ? ` · ${Math.max(1, Math.round(node.size / 1024))} KB` : ""}`}
                  </p>
                </button>
                <button
                  onClick={() => void handleRename(node)}
                  className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300"
                >
                  Rename
                </button>
                {node.type === "folder" ? (
                  <button
                    onClick={() => void handlePublish(node)}
                    disabled={publishingId === node.id}
                    className="rounded-md border border-emerald-500/30 px-2 py-1 text-[11px] text-emerald-200 disabled:opacity-50"
                  >
                    {publishingId === node.id ? "Publishing..." : "Publish"}
                  </button>
                ) : null}
                <button
                  onClick={() => void handleDelete(node)}
                  className="rounded-md border border-rose-500/30 px-2 py-1 text-[11px] text-rose-200"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      {viewingNode && (
        <FileViewerModal node={viewingNode} onClose={() => setViewingNode(null)} />
      )}
    </>
  );
}

async function buildBreadcrumbs(userId: string, parentId: string | null): Promise<FsNode[]> {
  const chain: FsNode[] = [];
  let currentId = parentId;

  while (currentId) {
    const node = await getNode(userId, currentId);
    if (!node || node.id === ROOT_NODE_ID) break;
    chain.unshift(node);
    currentId = node.parentId;
  }

  return chain;
}
