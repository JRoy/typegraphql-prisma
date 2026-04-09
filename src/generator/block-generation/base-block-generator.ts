import type { DmmfDocument } from "../dmmf/dmmf-document";
import type { GeneratorOptions } from "../options";
import type { GeneratedFile } from "../string-emitter";

export abstract class BaseBlockGenerator {
  protected dmmfDocument: DmmfDocument;
  protected options: GeneratorOptions;
  protected baseDirPath: string;

  constructor(
    dmmfDocument: DmmfDocument,
    options: GeneratorOptions,
    baseDirPath: string,
  ) {
    this.dmmfDocument = dmmfDocument;
    this.options = options;
    this.baseDirPath = baseDirPath;
  }

  protected abstract shouldGenerate(): boolean;

  public abstract generate(): Promise<GenerationResult> | GenerationResult;

  public abstract getBlockName(): string;
}

export interface GenerationMetrics {
  itemsGenerated: number;
  timeElapsed?: number;
}

export interface GenerationResult extends GenerationMetrics {
  files: GeneratedFile[];
}
