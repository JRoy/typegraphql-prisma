import { EmitBlockKind } from "./emit-block";

export interface ExternalGeneratorOptions {
  emitDMMF?: boolean;
  emitTranspiledCode?: boolean;
  simpleResolvers?: boolean;
  useOriginalMapping?: boolean;
  useUncheckedScalarInputs?: boolean;
  emitIdAsIDType?: boolean;
  emitOnly?: EmitBlockKind[];
  emitRedundantTypesInfo?: boolean;
  customPrismaImportPath?: string;
  contextPrismaKey?: string;
  useSimpleInputs?: boolean;
  omitInputFieldsByDefault?: string[];
  omitOutputFieldsByDefault?: string[];
  formatGeneratedCode?: boolean | "prettier" | "tsc" | "biome";
  emitIsAbstract?: boolean;
  verboseLogging?: boolean;
  omitInputsBarrel?: boolean;
  bundleIndex?: boolean;
  /**
   * Resolve relation fields by looking up the related rows by key, batched per
   * GraphQL context into one `findMany` per relation per tick, instead of
   * re-reading the parent row through Prisma's fluent API.
   */
  batchRelationResolvers?: boolean;
}

export interface InternalGeneratorOptions {
  outputDirPath: string;
  prismaClientPath: string;
}

export interface GeneratorOptions
  extends Omit<ExternalGeneratorOptions, "emitOnly" | "contextPrismaKey">,
    InternalGeneratorOptions {
  blocksToEmit: EmitBlockKind[];
  contextPrismaKey: string;
  relativePrismaOutputPath: string;
  absolutePrismaOutputPath: string | undefined;
}
