import path from "node:path";
import { performance } from "node:perf_hooks";

import { modelsFolderName } from "../config";
import { generateModelsBarrelFile } from "../imports";
import generateObjectTypeClassFromModel from "../model-type-class";
import { createGeneratedFiles } from "../string-emitter";
import {
  BaseBlockGenerator,
  type GenerationResult,
} from "./base-block-generator";

export class ModelBlockGenerator extends BaseBlockGenerator {
  protected shouldGenerate(): boolean {
    return this.dmmfDocument.shouldGenerateBlock("models");
  }

  public getBlockName(): string {
    return "models";
  }

  public generate(): GenerationResult {
    if (!this.shouldGenerate()) {
      return { files: [], itemsGenerated: 0 };
    }

    const startTime = performance.now();

    const files = this.dmmfDocument.datamodel.models.flatMap(model => {
      const modelOutputType = this.dmmfDocument.outputTypeCache.get(model.name);

      if (!modelOutputType) {
        throw new Error(
          `Model ${model.name} has no output type. This indicates a problem with the DMMF document processing.`,
        );
      }

      return generateObjectTypeClassFromModel(
        this.baseDirPath,
        model,
        modelOutputType,
        this.dmmfDocument,
      );
    });

    files.push(
      ...createGeneratedFiles(
        path.resolve(this.baseDirPath, modelsFolderName, "index"),
        generateModelsBarrelFile(
          this.dmmfDocument.datamodel.models.map(it => it.typeName),
        ),
      ),
    );

    return {
      files,
      itemsGenerated: this.dmmfDocument.datamodel.models.length,
      timeElapsed: performance.now() - startTime,
    };
  }
}
