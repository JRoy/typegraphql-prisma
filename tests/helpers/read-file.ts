import { promises as fs } from "fs";

export type ReadGeneratedFile = (filePath: string) => Promise<string>;

export default function createReadGeneratedFile(
  baseDirPath: string,
): ReadGeneratedFile {
  return async (filePath: string) => {
    const fullPath = baseDirPath + filePath;
    try {
      return await fs.readFile(fullPath, { encoding: "utf8" });
    } catch {
      if (filePath.endsWith(".ts") && !filePath.endsWith(".d.ts")) {
        return fs.readFile(fullPath.replace(/\.ts$/, ".js"), {
          encoding: "utf8",
        });
      }
      throw new Error(`Generated file not found: ${fullPath}`);
    }
  };
}
