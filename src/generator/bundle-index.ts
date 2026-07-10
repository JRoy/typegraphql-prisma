import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RELATIVE_REQUIRE_REGEX = /require\("(\.[^"]*)"\)/g;
const EXPORT_NAME_REGEX = /^exports\.([A-Za-z_$][A-Za-z0-9_$]*) = void 0;$/gm;

function resolveRequirePath(fromFile: string, specifier: string): string {
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    return path.join(base, "index.js");
  }
  if (base.endsWith(".js")) {
    return base;
  }
  return `${base}.js`;
}

function collectBundledFiles(indexPath: string): Set<string> {
  const bundled = new Set<string>();
  const stack = [indexPath];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (bundled.has(file)) {
      continue;
    }
    bundled.add(file);
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(RELATIVE_REQUIRE_REGEX)) {
      const resolved = resolveRequirePath(file, match[1]);
      if (!bundled.has(resolved) && fs.existsSync(resolved)) {
        stack.push(resolved);
      }
    }
  }
  return bundled;
}

function getExportNames(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  return [...content.matchAll(EXPORT_NAME_REGEX)].map(match => match[1]);
}

function isClassFile(baseDirPath: string, filePath: string): boolean {
  if (path.basename(filePath) === "index.js") {
    return false;
  }
  const relative = path.relative(baseDirPath, filePath);
  return (
    relative.startsWith(`enums${path.sep}`) ||
    relative.startsWith(`models${path.sep}`) ||
    relative.startsWith(path.join("resolvers", "inputs") + path.sep) ||
    relative.startsWith(path.join("resolvers", "outputs") + path.sep)
  );
}

function writeShimFile(
  baseDirPath: string,
  filePath: string,
  exportNames: string[],
): void {
  const relativeToIndex = toRequireSpecifier(
    path.relative(path.dirname(filePath), path.join(baseDirPath, "index.js")),
  );
  const lines = [
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    `const index = require("${relativeToIndex}");`,
    ...exportNames.map(name => `exports.${name} = index.${name};`),
    "",
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
}

function toRequireSpecifier(relativePath: string): string {
  const unix = relativePath.split(path.sep).join("/");
  return unix.startsWith(".") ? unix : `./${unix}`;
}

export async function bundlePackageIndex(
  baseDirPath: string,
  log: (msg: string) => void,
): Promise<void> {
  const indexPath = path.resolve(baseDirPath, "index.js");
  const bundledFiles = collectBundledFiles(indexPath);

  const inputsDirPath = path.join(baseDirPath, "resolvers", "inputs");
  const bundledInputFiles = [...bundledFiles].filter(
    file =>
      file.startsWith(inputsDirPath + path.sep) &&
      path.basename(file) !== "index.js",
  );

  // Reachable input classes are loaded through resolver args anyway, so
  // exporting them from the index costs nothing and lets the per-class shim
  // files resolve them from the bundle, preserving class identity.
  const extraExportLines = bundledInputFiles.flatMap(file => {
    const specifier = toRequireSpecifier(path.relative(baseDirPath, file));
    return getExportNames(file).map(
      name => `exports.${name} = require("${specifier}").${name};`,
    );
  });
  const originalIndexContent = fs.readFileSync(indexPath, "utf8");
  fs.writeFileSync(
    indexPath,
    `${originalIndexContent}\n${extraExportLines.join("\n")}\n`,
  );

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "typegraphql-bundle-"));
  try {
    await execFileAsync(
      "bun",
      [
        "build",
        indexPath,
        "--format=cjs",
        "--target=bun",
        "--bytecode",
        "--packages=external",
        "--outdir",
        outDir,
      ],
      { cwd: baseDirPath, maxBuffer: 256 * 1024 * 1024 },
    );

    // Replace every class file that got inlined into the bundle with a shim
    // re-exporting from the bundle, so deep imports share class identity with
    // the bundled copy instead of registering a duplicate GraphQL type.
    for (const file of bundledFiles) {
      if (isClassFile(baseDirPath, file)) {
        writeShimFile(baseDirPath, file, getExportNames(file));
      }
    }

    fs.copyFileSync(path.join(outDir, "index.js"), indexPath);
    const bytecodePath = path.join(outDir, "index.js.jsc");
    if (fs.existsSync(bytecodePath)) {
      fs.copyFileSync(bytecodePath, path.join(baseDirPath, "index.js.jsc"));
    }
    log(`Bundled package index (${bundledFiles.size} modules inlined)`);
  } catch (error) {
    fs.writeFileSync(indexPath, originalIndexContent);
    log(
      `Warning: bundleIndex failed, keeping unbundled index: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
