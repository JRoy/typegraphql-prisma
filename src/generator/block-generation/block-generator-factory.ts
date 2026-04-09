import type { DmmfDocument } from "../dmmf/dmmf-document";
import type { DMMF } from "../dmmf/types";
import type { GeneratorOptions } from "../options";
import type { GeneratedFile } from "../string-emitter";
import {
  type BaseBlockGenerator,
  CrudResolverBlockGenerator,
  EnumBlockGenerator,
  InputBlockGenerator,
  ModelBlockGenerator,
  OutputBlockGenerator,
  RelationResolverBlockGenerator,
  type GenerationMetrics,
} from "./index";

export class BlockGeneratorFactory {
  private dmmfDocument: DmmfDocument;
  private options: GeneratorOptions;
  private baseDirPath: string;
  private generators: Map<string, BaseBlockGenerator> = new Map();

  constructor(
    dmmfDocument: DmmfDocument,
    options: GeneratorOptions,
    baseDirPath: string,
  ) {
    this.dmmfDocument = dmmfDocument;
    this.options = options;
    this.baseDirPath = baseDirPath;

    this.initializeGenerators();
  }

  private initializeGenerators(): void {
    this.generators.set(
      "enums",
      new EnumBlockGenerator(this.dmmfDocument, this.options, this.baseDirPath),
    );
    this.generators.set(
      "models",
      new ModelBlockGenerator(
        this.dmmfDocument,
        this.options,
        this.baseDirPath,
      ),
    );
    this.generators.set(
      "inputs",
      new InputBlockGenerator(
        this.dmmfDocument,
        this.options,
        this.baseDirPath,
      ),
    );
    this.generators.set(
      "outputs",
      new OutputBlockGenerator(
        this.dmmfDocument,
        this.options,
        this.baseDirPath,
      ),
    );
    this.generators.set(
      "relationResolvers",
      new RelationResolverBlockGenerator(
        this.dmmfDocument,
        this.options,
        this.baseDirPath,
      ),
    );
    this.generators.set(
      "crudResolvers",
      new CrudResolverBlockGenerator(
        this.dmmfDocument,
        this.options,
        this.baseDirPath,
      ),
    );
  }

  public async generateAllBlocks(
    log: (msg: string) => void,
    metricsCallback?: (blockName: string, metrics: GenerationMetrics) => void,
  ): Promise<{
    files: GeneratedFile[];
    outputTypesToGenerate: DMMF.OutputType[];
  }> {
    let outputTypesToGenerate: DMMF.OutputType[] = [];
    const files: GeneratedFile[] = [];

    const blockOrder = [
      "enums",
      "models",
      "outputs",
      "inputs",
      "relationResolvers",
      "crudResolvers",
    ];

    for (const blockName of blockOrder) {
      const generator = this.generators.get(blockName);
      if (!generator) {
        continue;
      }

      log(`Generating ${generator.getBlockName()}...`);
      const result = await generator.generate();
      files.push(...result.files);

      if (metricsCallback && result.itemsGenerated > 0) {
        metricsCallback(blockName, result);
      }

      if (
        blockName === "outputs" &&
        generator instanceof OutputBlockGenerator
      ) {
        outputTypesToGenerate = generator.getGeneratedOutputTypes();
      }
    }

    return { files, outputTypesToGenerate };
  }

  public getGenerator(blockName: string): BaseBlockGenerator | undefined {
    return this.generators.get(blockName);
  }

  public hasGenerator(blockName: string): boolean {
    return this.generators.has(blockName);
  }

  public getAllGenerators(): BaseBlockGenerator[] {
    return Array.from(this.generators.values());
  }
}
