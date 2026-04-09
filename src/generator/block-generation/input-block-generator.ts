import path from "node:path";
import { performance } from "node:perf_hooks";

import { inputsFolderName, resolversFolderName } from "../config";
import { generateInputsBarrelFile } from "../imports";
import { createGeneratedFiles } from "../string-emitter";
import { generateInputTypeClassFromType } from "../type-class";
import {
  BaseBlockGenerator,
  type GenerationResult,
} from "./base-block-generator";

export class InputBlockGenerator extends BaseBlockGenerator {
  protected shouldGenerate(): boolean {
    return this.dmmfDocument.shouldGenerateBlock("inputs");
  }

  public getBlockName(): string {
    return "inputs";
  }

  public generate(): GenerationResult {
    if (!this.shouldGenerate()) {
      return { files: [], itemsGenerated: 0 };
    }

    const startTime = performance.now();
    const resolversDirPath = path.resolve(
      this.baseDirPath,
      resolversFolderName,
    );
    const allInputTypes: string[] = [];
    const files = this.dmmfDocument.schema.inputTypes.flatMap(type => {
      allInputTypes.push(type.typeName);
      return generateInputTypeClassFromType(
        resolversDirPath,
        type,
        this.options,
      );
    });

    files.push(
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          inputsFolderName,
          "index",
        ),
        generateInputsBarrelFile(allInputTypes),
      ),
    );

    return {
      files,
      itemsGenerated: this.dmmfDocument.schema.inputTypes.length,
      timeElapsed: performance.now() - startTime,
    };
  }
}
