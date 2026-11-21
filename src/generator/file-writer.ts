import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
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
  const directories = [
    ...new Set(dedupedFiles.map(file => path.dirname(file.filePath))),
  ];
  let nextIndex = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, directories.length) },
      async () => {
        while (nextIndex < directories.length) {
          await fs.mkdir(directories[nextIndex++], { recursive: true });
        }
      },
    ),
  );
  for (const file of dedupedFiles) {
    writeFileSync(file.filePath, file.content, "utf8");
  }
}

function dedupeFiles(files: GeneratedFile[]): GeneratedFile[] {
  const filesByPath = new Map<string, GeneratedFile>();
  for (const file of files) {
    filesByPath.set(file.filePath, file);
  }
  return [...filesByPath.values()];
}
