import { existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Replacement for `require(outputDirPath)` after the generator stopped
 * emitting a populated root index. Resolves a property by trying each
 * subpath where it could live (model / enum / input / output / relation
 * resolver / crud resolver / crud action resolver / crud action args).
 */
export function requireGenerated(outputDirPath: string): Record<string, any> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;

        const subpathCandidates = [
          `${outputDirPath}/models/${prop}`,
          `${outputDirPath}/enums/${prop}`,
          `${outputDirPath}/resolvers/inputs/${prop}`,
          `${outputDirPath}/resolvers/outputs/${prop}`,
          `${outputDirPath}/resolvers/relations/${prop.replace(/RelationsResolver$/, "")}/${prop}`,
          `${outputDirPath}/resolvers/crud/${prop.replace(/CrudResolver$/, "").replace(/Resolver$/, "")}/${prop}`,
        ];

        for (const candidate of subpathCandidates) {
          try {
            const mod = require(candidate);
            if (mod && prop in mod) return mod[prop];
          } catch {}
        }

        const crudDir = join(outputDirPath, "resolvers", "crud");
        if (existsSync(crudDir)) {
          for (const modelDir of readdirSync(crudDir)) {
            const candidates = prop.endsWith("Args")
              ? [join(crudDir, modelDir, "args", prop)]
              : [join(crudDir, modelDir, prop)];
            for (const candidate of candidates) {
              try {
                const mod = require(candidate);
                if (mod && prop in mod) return mod[prop];
              } catch {}
            }
          }
        }

        return undefined;
      },
    },
  ) as Record<string, any>;
}
