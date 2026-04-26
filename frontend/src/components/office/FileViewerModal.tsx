"use client";

import type { FsNode } from "@/src/lib/filesystem";
import { useEffect, useState } from "react";

type FileViewerModalProps = {
  node: FsNode;
  onClose: () => void;
};

export function FileViewerModal({ node, onClose }: FileViewerModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (node.kind === "code" || (!node.kind && node.mimeType?.startsWith("text/"))) {
      if (!node.downloadURL) return;
      setLoading(true);
      fetch(node.downloadURL)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load text content");
          return res.text();
        })
        .then((text) => setContent(text))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [node]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm pointer-events-auto">
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/50 p-3">
          <div>
            <h3 className="font-semibold text-white">{node.name}</h3>
            <p className="text-xs text-slate-400">{node.mimeType || "Unknown type"}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={node.downloadURL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/30"
            >
              Open externally
            </a>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 flex items-center justify-center min-h-[400px]">
          {loading ? (
             <p className="text-slate-400">Loading document...</p>
          ) : error ? (
             <p className="text-rose-400">Error: {error}</p>
          ) : node.kind === "photo" || (!node.kind && node.mimeType?.startsWith("image/")) ? (
            <img src={node.downloadURL} alt={node.name} className="max-h-full max-w-full object-contain" />
          ) : node.kind === "video" || (!node.kind && node.mimeType?.startsWith("video/")) ? (
            <video src={node.downloadURL} controls autoPlay className="max-h-full max-w-full object-contain" />
          ) : node.kind === "music" || (!node.kind && node.mimeType?.startsWith("audio/")) ? (
            <div className="w-full max-w-md bg-slate-800 p-6 rounded-xl flex flex-col items-center">
               <div className="mb-4 h-24 w-24 bg-emerald-500/20 rounded-full flex items-center justify-center">
                 <span className="text-4xl">🎵</span>
               </div>
               <audio src={node.downloadURL} controls autoPlay className="w-full" />
            </div>
          ) : node.kind === "code" || (!node.kind && node.mimeType?.startsWith("text/")) ? (
            <pre className="h-full w-full whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-mono text-sm text-slate-300">
              {content}
            </pre>
          ) : (
             <div className="text-center">
               <span className="text-4xl mb-4 block">📄</span>
               <p className="text-slate-400">No viewer available for this file type.</p>
               <a href={node.downloadURL} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline text-sm mt-2 block">Download file</a>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
