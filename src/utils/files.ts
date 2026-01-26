import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadedFile, FileType } from "../types.js";
import { createChildLogger } from "./logger.js";

const logger = createChildLogger("files");

// MIME type to file type mapping
const MIME_TYPE_MAP: Record<string, FileType> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "text/plain": "text",
  "text/markdown": "text",
  "text/html": "text",
  "text/css": "text",
  "text/javascript": "text",
  "application/json": "text",
  "application/javascript": "text",
  "application/typescript": "text",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "video/mp4": "video",
  "video/webm": "video",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
};

// Text file extensions
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".css", ".scss", ".html", ".xml",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".zsh",
  ".sql", ".graphql", ".vue", ".svelte", ".astro",
]);

export function getFileType(mimeType: string, fileName: string): FileType {
  // Check MIME type first
  if (MIME_TYPE_MAP[mimeType]) {
    return MIME_TYPE_MAP[mimeType];
  }

  // Fall back to extension
  const ext = extname(fileName).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return "text";
  }

  if (ext.match(/\.(jpe?g|png|gif|webp|bmp|svg)$/i)) {
    return "image";
  }

  if (ext.match(/\.(mp3|wav|ogg|m4a|flac)$/i)) {
    return "audio";
  }

  if (ext.match(/\.(mp4|webm|mov|avi|mkv)$/i)) {
    return "video";
  }

  if (ext.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i)) {
    return "document";
  }

  return "other";
}

export function ensureDirectoryExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    logger.debug({ dirPath }, "Created directory");
  }
}

export async function downloadFile(
  url: string,
  destDir: string,
  fileName: string
): Promise<string> {
  ensureDirectoryExists(destDir);
  const destPath = join(destDir, fileName);

  logger.info({ url, destPath }, "Downloading file");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("No response body");
  }

  const nodeStream = Readable.fromWeb(body as import("stream/web").ReadableStream);
  const fileStream = createWriteStream(destPath);

  await pipeline(nodeStream, fileStream);
  logger.info({ destPath }, "File downloaded successfully");

  return destPath;
}

export function readTextFile(filePath: string, maxSize: number = 100000): string {
  const stats = statSync(filePath);
  if (stats.size > maxSize) {
    logger.warn({ filePath, size: stats.size, maxSize }, "File too large, truncating");
  }

  const content = readFileSync(filePath, "utf-8");
  return content.slice(0, maxSize);
}

export function formatFileForPrompt(file: DownloadedFile): string {
  const fileType = getFileType(file.mimeType, file.fileName);

  switch (fileType) {
    case "text":
      const content = readTextFile(file.path);
      return `File: ${file.fileName}\n\`\`\`\n${content}\n\`\`\``;

    case "image":
      return `[Image: ${file.fileName} at ${file.path}]`;

    case "document":
      return `[Document: ${file.fileName} saved at ${file.path}]`;

    case "audio":
      return `[Audio: ${file.fileName} saved at ${file.path}]`;

    case "video":
      return `[Video: ${file.fileName} saved at ${file.path}]`;

    default:
      return `[File: ${file.fileName} saved at ${file.path}]`;
  }
}

export function generateTempFileName(originalName: string): string {
  const ext = extname(originalName);
  const base = basename(originalName, ext);
  const timestamp = Date.now();
  return `${base}-${timestamp}${ext}`;
}
