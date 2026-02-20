import path from "node:path";
import fs from "node:fs";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { exec } from "node:child_process";

import type { DMMF as PrismaDMMF } from "@prisma/generator-helper";
import {
  Project,
  ScriptTarget,
  ModuleKind,
  type CompilerOptions,
  type SourceFile,
  ts,
} from "ts-morph";

import { noop, toUnixPath } from "./helpers";
import { generateIndexFile } from "./imports";
import type {
  InternalGeneratorOptions,
  ExternalGeneratorOptions,
  GeneratorOptions as BaseGeneratorOptions,
} from "./options";

import { DmmfDocument } from "./dmmf/dmmf-document";
import { BlockGeneratorFactory } from "./block-generation/block-generator-factory";

import { ensureInstalledCorrectPrismaPackage } from "../utils/prisma-version";
import { generateEnhanceMap } from "./generate-enhance";
import { generateCustomScalars } from "./generate-scalars";
import { generateHelpersFile } from "./generate-helpers";
import { getBlocksToEmit } from "./emit-block";
import type { MetricsListener } from "./metrics";

const execa = promisify(exec);

const baseCompilerOptions: CompilerOptions = {
  target: ScriptTarget.ES2021,
  module: ModuleKind.CommonJS,
  emitDecoratorMetadata: true,
  experimentalDecorators: true,
  esModuleInterop: true,
  skipLibCheck: true,
};

class CodeGenerator {
  constructor(private metrics?: MetricsListener) {}

  private resolveFormatGeneratedCodeOption(
    formatOption: boolean | "prettier" | "tsc" | "biome" | undefined,
  ): "prettier" | "tsc" | "biome" | undefined {
    if (formatOption === false || formatOption === undefined) {
      // No formatting by default — saves significant time.
      // The previous default "tsc" ran `tsc --noEmit` which is type-checking,
      // not formatting, and fails without a tsconfig in the output directory.
      return undefined;
    }
    if (formatOption === true) {
      return "tsc"; // Explicit true means use tsc
    }
    // formatOption is either 'prettier', 'tsc', or 'biome' string
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
    const emitTranspiledCode =
      options.emitTranspiledCode ??
      options.outputDirPath.includes("node_modules");

    const projectCompilerOptions = Object.assign(
      {},
      baseCompilerOptions,
      emitTranspiledCode
        ? {
            declaration: true,
            importHelpers: true,
          }
        : {},
    );

    const project = new Project({ compilerOptions: projectCompilerOptions });
    const inputProject = new Project({
      compilerOptions: projectCompilerOptions,
    });

    log("Transforming dmmfDocument...");
    const dmmfStart = performance.now();
    const dmmfDocument = new DmmfDocument(dmmf, options);
    this.metrics?.emitMetric(
      "dmmf-document-creation",
      performance.now() - dmmfStart,
    );

    // Initialize block generator factory
    const blockGeneratorFactory = new BlockGeneratorFactory(
      project,
      inputProject,
      dmmfDocument,
      options,
      baseDirPath,
    );

    // Generate all blocks using the factory
    const outputTypesToGenerate = await blockGeneratorFactory.generateAllBlocks(
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

    // Generate auxiliary files
    log("Generate auxiliary files");
    const auxiliaryStart = performance.now();
    const enhanceSourceFile = project.createSourceFile(
      `${baseDirPath}/enhance.ts`,
      undefined,
      { overwrite: true },
    );
    generateEnhanceMap(
      enhanceSourceFile,
      dmmfDocument,
      dmmfDocument.modelMappings,
      dmmfDocument.relationModels,
      dmmfDocument.datamodel.models,
      dmmfDocument.schema.inputTypes,
      outputTypesToGenerate,
    );

    const scalarsSourceFile = project.createSourceFile(
      `${baseDirPath}/scalars.ts`,
      undefined,
      { overwrite: true },
    );
    generateCustomScalars(scalarsSourceFile, dmmfDocument);

    const helpersSourceFile = project.createSourceFile(
      `${baseDirPath}/helpers.ts`,
      undefined,
      { overwrite: true },
    );
    generateHelpersFile(helpersSourceFile, dmmfDocument.options);

    const indexSourceFile = project.createSourceFile(
      `${baseDirPath}/index.ts`,
      undefined,
      { overwrite: true },
    );
    generateIndexFile(
      indexSourceFile,
      dmmfDocument.relationModels.length > 0,
      dmmfDocument.options.blocksToEmit,
    );
    this.metrics?.emitMetric(
      "auxiliary-files",
      performance.now() - auxiliaryStart,
    );

    const allProjects = [project, inputProject];

    log("Emitting final code");
    const emitStart = performance.now();
    if (emitTranspiledCode) {
      log("Transpiling generated code");
      await this.fastEmitTranspiledCode(allProjects, baseDirPath, log);
    } else {
      log("Saving generated code");
      const saveStart = performance.now();
      await Promise.all(allProjects.map(p => p.save()));
      this.metrics?.emitMetric("save-files", performance.now() - saveStart);
    }

    // Format generated code if enabled
    if (options.formatGeneratedCode) {
      try {
        log(`Formatting generated code with ${options.formatGeneratedCode}`);
        const formatStart = performance.now();

        if (options.formatGeneratedCode === "tsc") {
          // Use tsc for formatting
          const tscStart = performance.now();
          const tscArgs = ["--noEmit", "--project", baseDirPath];
          await execa(`tsc ${tscArgs.join(" ")}`, { cwd: baseDirPath });
          this.metrics?.emitMetric(
            "tsc-formatting",
            performance.now() - tscStart,
          );
        } else if (options.formatGeneratedCode === "prettier") {
          // Use prettier for formatting
          const prettierStart = performance.now();
          const prettierArgs = [
            "--write",
            `${baseDirPath}/**/*.ts`,
            "--ignore-path",
            path.resolve(baseDirPath, ".prettierignore"),
          ];

          // Check if prettier config exists, if not use default config
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
        } else {
          // Use biome for formatting
          const biomeStart = performance.now();
          const biomeArgs = ["format", "--write", `${baseDirPath}/**/*.ts`];

          // Check if biome config exists, if not use default behavior
          try {
            await fs.promises.access(path.resolve(baseDirPath, "biome.json"));
          } catch {
            // Biome will use its default configuration if no config file is found
          }

          await execa(`npx biome ${biomeArgs.join(" ")}`, { cwd: baseDirPath });
          this.metrics?.emitMetric(
            "biome-formatting",
            performance.now() - biomeStart,
          );
        }

        this.metrics?.emitMetric(
          "code-formatting",
          performance.now() - formatStart,
        );
      } catch (error) {
        // Don't fail the entire generation for formatting errors
        log(
          `Warning: Code formatting failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.metrics?.emitMetric("code-emission", performance.now() - emitStart);
    this.metrics?.emitMetric("total-generation", performance.now() - startTime);
    this.metrics?.onComplete?.();
  }

  /**
   * Replaces the slow `project.emit()` path which runs the full TypeScript
   * type-checker on every source file (O(n²) for cross-file resolution).
   *
   * Instead:
   *  1. Save .ts files to disk via project.save()
   *  2. Transpile each .ts → .js independently via ts.transpileModule()
   *     (no type-checking, supports emitDecoratorMetadata)
   *  3. Generate .d.ts via ts.createProgram() with noCheck (TS 5.6+)
   *     which skips the expensive type-checker pass
   */
  private async fastEmitTranspiledCode(
    projects: Project[],
    baseDirPath: string,
    log: (msg: string) => void,
  ): Promise<void> {
    const sourceFiles = projects.flatMap(p => p.getSourceFiles());

    // Phase 1: Write .ts source files to disk
    const saveStart = performance.now();
    await Promise.all(projects.map(p => p.save()));
    this.metrics?.emitMetric("save-ts-files", performance.now() - saveStart);

    // Phase 2: Per-file JS transpilation — no type-checker, supports decorators
    log("  Transpiling .ts → .js (per-file, no type-checking)");
    const transpileStart = performance.now();

    const jsCompilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
      importHelpers: true,
      declaration: false,
      sourceMap: false,
    };

    const JS_BATCH_SIZE = 200;
    for (let i = 0; i < sourceFiles.length; i += JS_BATCH_SIZE) {
      const batch = sourceFiles.slice(i, i + JS_BATCH_SIZE);
      const transpiled = batch.map((sf: SourceFile) => {
        const filePath = sf.getFilePath() as string;
        const result = ts.transpileModule(sf.getFullText(), {
          compilerOptions: jsCompilerOptions,
          fileName: path.basename(filePath),
        });
        return {
          jsPath: filePath.replace(/\.ts$/, ".js"),
          content: result.outputText,
        };
      });
      await Promise.all(
        transpiled.map(f => fs.promises.writeFile(f.jsPath, f.content)),
      );
    }

    this.metrics?.emitMetric(
      "transpile-js",
      performance.now() - transpileStart,
      sourceFiles.length,
    );

    // Phase 3: Generate .d.ts declarations
    log("  Generating .d.ts declarations");
    const dtsStart = performance.now();

    const filePaths = sourceFiles.map(sf => sf.getFilePath() as string);
    const dtsCompilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
      importHelpers: true,
      skipLibCheck: true,
      declaration: true,
      emitDeclarationOnly: true,
      // TS 5.6+: skip type-checker for declaration emit.
      // On older TS versions this flag is silently ignored (checker runs normally).
      noCheck: true,
    };

    const host = ts.createCompilerHost(dtsCompilerOptions);
    const dtsProgram = ts.createProgram(filePaths, dtsCompilerOptions, host);
    dtsProgram.emit();

    this.metrics?.emitMetric(
      "generate-dts",
      performance.now() - dtsStart,
      sourceFiles.length,
    );
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
