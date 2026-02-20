import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  BaseBlockGenerator,
  type GenerationMetrics,
} from "./base-block-generator";
import { generateInputTypeText } from "../type-class";
import { generateInputsBarrelFile } from "../imports";
import { resolversFolderName, inputsFolderName } from "../config";

export class InputBlockGenerator extends BaseBlockGenerator {
  protected shouldGenerate(): boolean {
    return this.dmmfDocument.shouldGenerateBlock("inputs");
  }

  public getBlockName(): string {
    return "inputs";
  }

  public generate(): GenerationMetrics {
    if (!this.shouldGenerate()) {
      return { itemsGenerated: 0 };
    }

    const startTime = performance.now();
    const inputsDirPath = path.resolve(
      this.baseDirPath,
      resolversFolderName,
      inputsFolderName,
    );
    fs.mkdirSync(inputsDirPath, { recursive: true });

    const allInputTypes: string[] = [];
    const directWrittenFilePaths: string[] = [];

    for (const type of this.dmmfDocument.schema.inputTypes) {
      allInputTypes.push(type.typeName);
      const filePath = path.resolve(inputsDirPath, `${type.typeName}.ts`);
      const content = generateInputTypeText(type, this.options);
      fs.writeFileSync(filePath, content);
      directWrittenFilePaths.push(filePath);
    }

    const inputsBarrelExportSourceFile = this.project.createSourceFile(
      path.resolve(inputsDirPath, "index.ts"),
      undefined,
      { overwrite: true },
    );
    generateInputsBarrelFile(inputsBarrelExportSourceFile, allInputTypes);

    return {
      itemsGenerated: this.dmmfDocument.schema.inputTypes.length,
      timeElapsed: performance.now() - startTime,
      directWrittenFilePaths,
    };
  }
}
