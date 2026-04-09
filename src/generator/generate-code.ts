import path from "node:path";
import fs from "node:fs";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { exec } from "node:child_process";

import type { DMMF as PrismaDMMF } from "@prisma/generator-helper";

import { noop, toUnixPath } from "./helpers";
import { BlockGeneratorFactory } from "./block-generation/block-generator-factory";
import type {
  ExternalGeneratorOptions,
  GeneratorOptions as BaseGeneratorOptions,
  InternalGeneratorOptions,
} from "./options";
import { DmmfDocument } from "./dmmf/dmmf-document";
import { getBlocksToEmit } from "./emit-block";
import { writeGeneratedFiles } from "./file-writer";
import { generateEnhanceMap } from "./generate-enhance";
import { generateHelpersFile } from "./generate-helpers";
import { generateCustomScalars } from "./generate-scalars";
import { generateIndexFile } from "./imports";
import type { MetricsListener } from "./metrics";
import { createGeneratedFiles } from "./string-emitter";

import { ensureInstalledCorrectPrismaPackage } from "../utils/prisma-version";

const execa = promisify(exec);

class CodeGenerator {
  constructor(private metrics?: MetricsListener) {}

  private resolveFormatGeneratedCodeOption(
    formatOption: boolean | "prettier" | "tsc" | "biome" | undefined,
  ): "prettier" | "tsc" | "biome" | undefined {
    if (formatOption === false) {
      return undefined;
    }
    if (formatOption === undefined || formatOption === true) {
      return "tsc";
    }
    return formatOption;
  }

  async generate(
    dmmf: PrismaDMMF.Document,
    baseOptions: InternalGeneratorOptions & ExternalGeneratorOptions,
    log: (msg: string) => void = noop,
  ): Promise<void> {
    const startTime = performance.now();
    ensureInstalledCorrectPrismaPackage();

    const options: BaseGeneratorOptions = Object.assign({}, baseOptions, {
      blocksToEmit: getBlocksToEmit(baseOptions.emitOnly),
      contextPrismaKey: baseOptions.contextPrismaKey ?? "prisma",
      relativePrismaOutputPath: toUnixPath(
        path.relative(baseOptions.outputDirPath, baseOptions.prismaClientPath),
      ),
      absolutePrismaOutputPath:
        !baseOptions.customPrismaImportPath &&
        baseOptions.prismaClientPath.includes("node_modules")
          ? "@prisma/client"
          : undefined,
      formatGeneratedCode: this.resolveFormatGeneratedCodeOption(
        baseOptions.formatGeneratedCode,
      ),
    });

    const baseDirPath = options.outputDirPath;

    log("Transforming dmmfDocument...");
    const dmmfStart = performance.now();
    const dmmfDocument = new DmmfDocument(dmmf, options);
    this.metrics?.emitMetric(
      "dmmf-document-creation",
      performance.now() - dmmfStart,
    );

    const blockGeneratorFactory = new BlockGeneratorFactory(
      dmmfDocument,
      options,
      baseDirPath,
    );

    const { files, outputTypesToGenerate } =
      await blockGeneratorFactory.generateAllBlocks(
        log,
        (blockName, metrics) => {
          if (this.metrics && metrics.timeElapsed) {
            this.metrics.emitMetric(
              `${blockName}-generation`,
              metrics.timeElapsed,
              metrics.itemsGenerated,
            );
          }
        },
      );

    log("Generate auxiliary files");
    const auxiliaryStart = performance.now();
    files.push(
      ...createGeneratedFiles(
        path.resolve(baseDirPath, "enhance"),
        generateEnhanceMap(
          dmmfDocument,
          dmmfDocument.modelMappings,
          dmmfDocument.relationModels,
          dmmfDocument.datamodel.models,
          dmmfDocument.schema.inputTypes,
          outputTypesToGenerate,
        ),
      ),
      ...createGeneratedFiles(
        path.resolve(baseDirPath, "scalars"),
        generateCustomScalars(dmmfDocument),
      ),
      ...createGeneratedFiles(
        path.resolve(baseDirPath, "helpers"),
        generateHelpersFile(dmmfDocument.options),
      ),
      ...createGeneratedFiles(
        path.resolve(baseDirPath, "index"),
        generateIndexFile(
          dmmfDocument.relationModels.length > 0,
          dmmfDocument.options.blocksToEmit,
        ),
      ),
    );
    this.metrics?.emitMetric(
      "auxiliary-files",
      performance.now() - auxiliaryStart,
    );

    log("Writing generated files");
    const emitStart = performance.now();
    await writeGeneratedFiles(files);

    if (options.formatGeneratedCode) {
      try {
        log(`Formatting generated code with ${options.formatGeneratedCode}`);
        const formatStart = performance.now();

        if (options.formatGeneratedCode === "prettier") {
          const prettierStart = performance.now();
          const prettierArgs = [
            "--write",
            `${baseDirPath}/**/*.{js,d.ts}`,
            "--ignore-path",
            path.resolve(baseDirPath, ".prettierignore"),
          ];

          try {
            await fs.promises.access(path.resolve(baseDirPath, ".prettierrc"));
          } catch {
            prettierArgs.push(
              "--config",
              JSON.stringify({
                semi: true,
                trailingComma: "es5",
                singleQuote: false,
                printWidth: 120,
                tabWidth: 2,
                useTabs: false,
              }),
            );
          }

          await execa(`npx prettier ${prettierArgs.join(" ")}`, {
            cwd: baseDirPath,
          });
          this.metrics?.emitMetric(
            "prettier-formatting",
            performance.now() - prettierStart,
          );
        } else if (options.formatGeneratedCode === "biome") {
          const biomeStart = performance.now();
          await execa(
            `npx biome format --write ${baseDirPath}/**/*.{js,d.ts}`,
            {
              cwd: baseDirPath,
            },
          );
          this.metrics?.emitMetric(
            "biome-formatting",
            performance.now() - biomeStart,
          );
        } else {
          log("Skipping tsc formatting for direct js/d.ts emission");
        }

        this.metrics?.emitMetric(
          "code-formatting",
          performance.now() - formatStart,
        );
      } catch (error) {
        log(
          `Warning: Code formatting failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.metrics?.emitMetric("code-emission", performance.now() - emitStart);
    this.metrics?.emitMetric("total-generation", performance.now() - startTime);
    this.metrics?.onComplete?.();
  }
}

export default async function generateCode(
  dmmf: PrismaDMMF.Document,
  baseOptions: InternalGeneratorOptions & ExternalGeneratorOptions,
  log: (msg: string) => void = noop,
  metrics?: MetricsListener,
): Promise<void> {
  const generator = new CodeGenerator(metrics);
  return generator.generate(dmmf, baseOptions, log);
}
