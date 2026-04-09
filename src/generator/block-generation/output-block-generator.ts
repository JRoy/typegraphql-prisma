import path from "node:path";
import { performance } from "node:perf_hooks";

import generateArgsTypeClassFromArgs from "../args-class";
import {
  argsFolderName,
  outputsFolderName,
  resolversFolderName,
} from "../config";
import type { DMMF } from "../dmmf/types";
import { generateArgsBarrelFile, generateOutputsBarrelFile } from "../imports";
import { createGeneratedFiles } from "../string-emitter";
import { generateOutputTypeClassFromType } from "../type-class";
import {
  BaseBlockGenerator,
  type GenerationResult,
} from "./base-block-generator";

export class OutputBlockGenerator extends BaseBlockGenerator {
  private outputTypesToGenerate: DMMF.OutputType[] = [];

  protected shouldGenerate(): boolean {
    return this.dmmfDocument.shouldGenerateBlock("outputs");
  }

  public getBlockName(): string {
    return "outputs";
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

    const rootTypes = this.dmmfDocument.schema.outputTypes.filter(type =>
      ["Query", "Mutation"].includes(type.name),
    );
    const modelNames = this.dmmfDocument.datamodel.models.map(
      model => model.name,
    );
    this.outputTypesToGenerate = this.dmmfDocument.schema.outputTypes.filter(
      type => !modelNames.includes(type.name) && !rootTypes.includes(type),
    );

    const outputTypesFieldsArgsToGenerate = this.outputTypesToGenerate
      .flatMap(it => it.fields)
      .filter(it => it.argsTypeName);

    const files = this.outputTypesToGenerate.flatMap(type =>
      generateOutputTypeClassFromType(
        resolversDirPath,
        type,
        this.dmmfDocument,
      ),
    );

    if (outputTypesFieldsArgsToGenerate.length > 0) {
      outputTypesFieldsArgsToGenerate.forEach(field => {
        if (!field.argsTypeName) {
          throw new Error(
            `Expected argsTypeName to be defined for field after filtering, but got ${field.argsTypeName}`,
          );
        }
        files.push(
          ...generateArgsTypeClassFromArgs(
            path.resolve(resolversDirPath, outputsFolderName),
            field.args,
            field.argsTypeName,
            this.dmmfDocument,
            2,
          ),
        );
      });

      files.push(
        ...createGeneratedFiles(
          path.resolve(
            this.baseDirPath,
            resolversFolderName,
            outputsFolderName,
            argsFolderName,
            "index",
          ),
          generateArgsBarrelFile(
            outputTypesFieldsArgsToGenerate.map(it => {
              if (!it.argsTypeName) {
                throw new Error(
                  `Expected argsTypeName to be defined after filtering, but got ${it.argsTypeName}`,
                );
              }
              return it.argsTypeName;
            }),
          ),
        ),
      );
    }

    files.push(
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          outputsFolderName,
          "index",
        ),
        generateOutputsBarrelFile(
          this.outputTypesToGenerate.map(it => it.typeName),
          this.outputTypesToGenerate.some(type =>
            type.fields.some(field => field.argsTypeName),
          ),
        ),
      ),
    );

    return {
      files,
      itemsGenerated: this.outputTypesToGenerate.length,
      timeElapsed: performance.now() - startTime,
    };
  }

  public getGeneratedOutputTypes(): DMMF.OutputType[] {
    return this.outputTypesToGenerate;
  }
}
