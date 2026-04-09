import fs from "node:fs/promises";
import path from "node:path";

import type { GeneratedFile } from "./string-emitter";

const DEFAULT_CONCURRENCY = 256;

export async function writeGeneratedFiles(
  files: GeneratedFile[],
  concurrency = DEFAULT_CONCURRENCY,
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const dedupedFiles = dedupeFiles(files);
  let nextIndex = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, dedupedFiles.length) },
      async () => {
        while (nextIndex < dedupedFiles.length) {
          const file = dedupedFiles[nextIndex++];
          await fs.mkdir(path.dirname(file.filePath), { recursive: true });
          await fs.writeFile(file.filePath, file.content, "utf8");
        }
      },
    ),
  );
}

function dedupeFiles(files: GeneratedFile[]): GeneratedFile[] {
  const filesByPath = new Map<string, GeneratedFile>();
  for (const file of files) {
    filesByPath.set(file.filePath, file);
  }
  return [...filesByPath.values()];
}
