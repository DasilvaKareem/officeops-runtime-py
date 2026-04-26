import { db, storage } from "@/src/lib/firebase";
import {
  get,
  ref as dbRef,
  remove,
  set,
  update,
} from "firebase/database";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

export const ROOT_NODE_ID = "__root__";

export type FsNodeKind = "code" | "video" | "photo" | "music" | "other";

export type FsNode = {
  id: string;
  parentId: string | null;
  name: string;
  type: "folder" | "file";
  mimeType?: string;
  size?: number;
  storagePath?: string;
  downloadURL?: string;
  kind?: FsNodeKind;
  createdAt: number;
  updatedAt: number;
  ownerUid: string;
};

export type PublishedSite = {
  id: string;
  rootFolderId: string;
  name: string;
  entryPath: string;
  publishedAt: number;
  updatedAt: number;
  ownerUid: string;
  fileCount: number;
  urlPath: string;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function nodePath(userId: string, nodeId: string) {
  return `users/${userId}/fs/nodes/${nodeId}`;
}

function childrenPath(userId: string, parentId: string | null) {
  return `users/${userId}/fs/children/${parentId ?? ROOT_NODE_ID}`;
}

function sitePath(userId: string, siteId: string) {
  return `users/${userId}/sites/${siteId}`;
}

function detectKind(mimeType: string, fileName: string): FsNodeKind {
  const lower = fileName.toLowerCase();
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "music";
  if (
    mimeType.startsWith("text/") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".json") ||
    lower.endsWith(".md") ||
    lower.endsWith(".py") ||
    lower.endsWith(".css") ||
    lower.endsWith(".html")
  ) {
    return "code";
  }
  return "other";
}

function normalizeSegment(value: string) {
  return value.replace(/[\\]+/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

async function writeFileNode(
  userId: string,
  parentId: string | null,
  fileName: string,
  contentType: string,
  size: number,
  objectPath: string,
  kind: FsNodeKind
): Promise<FsNode> {
  const now = Date.now();
  const id = uid();
  const downloadURL = await getDownloadURL(storageRef(storage, objectPath));

  const node: FsNode = {
    id,
    parentId,
    name: fileName,
    type: "file",
    mimeType: contentType,
    size,
    storagePath: objectPath,
    downloadURL,
    kind,
    createdAt: now,
    updatedAt: now,
    ownerUid: userId,
  };

  await set(dbRef(db, nodePath(userId, id)), node);
  await update(dbRef(db, childrenPath(userId, parentId)), { [id]: true });
  return node;
}

export async function listChildren(userId: string, parentId: string | null): Promise<FsNode[]> {
  const childrenSnap = await get(dbRef(db, childrenPath(userId, parentId)));
  if (!childrenSnap.exists()) return [];

  const childIds = Object.keys(childrenSnap.val() as Record<string, true>);
  const nodes = await Promise.all(
    childIds.map(async (childId) => {
      const snap = await get(dbRef(db, nodePath(userId, childId)));
      return snap.exists() ? (snap.val() as FsNode) : null;
    })
  );

  return nodes
    .filter((node): node is FsNode => Boolean(node))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function getNode(userId: string, nodeId: string): Promise<FsNode | null> {
  if (nodeId === ROOT_NODE_ID) {
    return {
      id: ROOT_NODE_ID,
      parentId: null,
      name: "Home",
      type: "folder",
      createdAt: 0,
      updatedAt: 0,
      ownerUid: userId,
    };
  }

  const snap = await get(dbRef(db, nodePath(userId, nodeId)));
  return snap.exists() ? (snap.val() as FsNode) : null;
}

export async function createFolder(userId: string, parentId: string | null, name: string): Promise<FsNode> {
  const now = Date.now();
  const id = uid();
  const node: FsNode = {
    id,
    parentId,
    name,
    type: "folder",
    createdAt: now,
    updatedAt: now,
    ownerUid: userId,
  };

  await set(dbRef(db, nodePath(userId, id)), node);
  await update(dbRef(db, childrenPath(userId, parentId)), { [id]: true });

  return node;
}

export async function uploadUserFile(userId: string, parentId: string | null, file: File): Promise<FsNode> {
  const storageId = uid();
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "";
  const objectPath = `users/${userId}/files/${storageId}/original${extension ? `.${extension}` : ""}`;

  await uploadBytes(storageRef(storage, objectPath), file, {
    contentType: file.type || "application/octet-stream",
  });
  return writeFileNode(
    userId,
    parentId,
    file.name,
    file.type || "application/octet-stream",
    file.size,
    objectPath,
    detectKind(file.type || "", file.name)
  );
}

export async function uploadUserBlob(
  userId: string,
  parentId: string | null,
  fileName: string,
  blob: Blob,
  kind?: FsNodeKind
): Promise<FsNode> {
  const storageId = uid();
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  const contentType = blob.type || "application/octet-stream";
  const objectPath = `users/${userId}/files/${storageId}/original${extension ? `.${extension}` : ""}`;

  await uploadBytes(storageRef(storage, objectPath), blob, {
    contentType,
  });

  return writeFileNode(
    userId,
    parentId,
    fileName,
    contentType,
    blob.size,
    objectPath,
    kind ?? detectKind(contentType, fileName)
  );
}

export async function renameNode(userId: string, nodeId: string, name: string): Promise<void> {
  await update(dbRef(db, nodePath(userId, nodeId)), {
    name,
    updatedAt: Date.now(),
  });
}

export async function deleteNode(userId: string, node: FsNode): Promise<void> {
  if (node.type === "folder") {
    const children = await listChildren(userId, node.id);
    if (children.length > 0) {
      throw new Error("Folder is not empty.");
    }
  }

  if (node.storagePath) {
    await deleteObject(storageRef(storage, node.storagePath));
  }

  await remove(dbRef(db, nodePath(userId, node.id)));
  await remove(dbRef(db, `${childrenPath(userId, node.parentId)}/${node.id}`));
}

export async function publishWebsiteFolder(userId: string, folderId: string): Promise<PublishedSite> {
  const folder = await getNode(userId, folderId);
  if (!folder || folder.type !== "folder") {
    throw new Error("Folder not found.");
  }

  const files = await collectFolderFiles(userId, folderId);
  const entry = files.find((file) => file.relativePath === "index.html");
  if (!entry) {
    throw new Error("Folder must contain an index.html at its root.");
  }

  const siteId = uid();
  await Promise.all(
    files.map(async (file) => {
      if (!file.node.downloadURL) {
        throw new Error(`Missing download URL for ${file.node.name}`);
      }
      const response = await fetch(file.node.downloadURL);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${file.node.name} for publishing.`);
      }
      const blob = await response.blob();
      const targetPath = `published-sites/${siteId}/${file.relativePath}`;
      await uploadBytes(storageRef(storage, targetPath), blob, {
        contentType: file.node.mimeType || blob.type || "application/octet-stream",
      });
    })
  );

  const now = Date.now();
  const site: PublishedSite = {
    id: siteId,
    rootFolderId: folderId,
    name: folder.name,
    entryPath: "index.html",
    publishedAt: now,
    updatedAt: now,
    ownerUid: userId,
    fileCount: files.length,
    urlPath: `/sites/${siteId}`,
  };

  await set(dbRef(db, sitePath(userId, siteId)), site);
  return site;
}

async function collectFolderFiles(
  userId: string,
  folderId: string,
  prefix = ""
): Promise<Array<{ node: FsNode; relativePath: string }>> {
  const children = await listChildren(userId, folderId);
  const results: Array<{ node: FsNode; relativePath: string }> = [];

  for (const child of children) {
    const safeName = normalizeSegment(child.name);
    const relativePath = prefix ? `${prefix}/${safeName}` : safeName;

    if (child.type === "folder") {
      const nested = await collectFolderFiles(userId, child.id, relativePath);
      results.push(...nested);
      continue;
    }

    results.push({ node: child, relativePath });
  }

  return results;
}
