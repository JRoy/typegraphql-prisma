import path from "node:path";
import { performance } from "node:perf_hooks";

import generateArgsTypeClassFromArgs from "../args-class";
import {
  argsFolderName,
  relationsResolversFolderName,
  resolversFolderName,
} from "../config";
import {
  generateArgsBarrelFile,
  generateArgsIndexFile,
  generateResolversBarrelFile,
  generateResolversIndexFile,
} from "../imports";
import generateRelationsResolverClassesFromModel from "../resolvers/relations";
import { createGeneratedFiles } from "../string-emitter";
import type { GenerateMappingData } from "../types";
import {
  BaseBlockGenerator,
  type GenerationResult,
} from "./base-block-generator";

export class RelationResolverBlockGenerator extends BaseBlockGenerator {
  protected shouldGenerate(): boolean {
    return (
      this.dmmfDocument.relationModels.length > 0 &&
      this.dmmfDocument.shouldGenerateBlock("relationResolvers")
    );
  }

  public getBlockName(): string {
    return "relationResolvers";
  }

  public generate(): GenerationResult {
    if (!this.shouldGenerate()) {
      return { files: [], itemsGenerated: 0 };
    }

    const startTime = performance.now();
    const files = this.dmmfDocument.relationModels.flatMap(relationModel =>
      generateRelationsResolverClassesFromModel(
        this.baseDirPath,
        this.dmmfDocument,
        relationModel,
        this.options,
      ),
    );

    files.push(...this.generateBarrelFiles());
    files.push(...this.generateArgs());

    return {
      files,
      itemsGenerated: this.dmmfDocument.relationModels.length,
      timeElapsed: performance.now() - startTime,
    };
  }

  private generateBarrelFiles() {
    const relationModelsWithArgs = this.dmmfDocument.relationModels.filter(
      relationModelData =>
        relationModelData.relationFields.some(
          it => it.argsTypeName !== undefined,
        ),
    );

    return [
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          relationsResolversFolderName,
          "resolvers.index",
        ),
        generateResolversBarrelFile(
          this.dmmfDocument.relationModels.map<GenerateMappingData>(
            relationModel => ({
              resolverName: relationModel.resolverName,
              modelName: relationModel.model.typeName,
            }),
          ),
        ),
      ),
      ...(relationModelsWithArgs.length > 0
        ? createGeneratedFiles(
            path.resolve(
              this.baseDirPath,
              resolversFolderName,
              relationsResolversFolderName,
              "args.index",
            ),
            generateArgsIndexFile(
              relationModelsWithArgs.map(
                relationModelData => relationModelData.model.typeName,
              ),
            ),
          )
        : []),
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          relationsResolversFolderName,
          "index",
        ),
        generateResolversIndexFile(
          "relations",
          relationModelsWithArgs.length > 0,
        ),
      ),
    ];
  }

  private generateArgs() {
    const files = [] as ReturnType<typeof createGeneratedFiles>;

    this.dmmfDocument.relationModels.forEach(relationModelData => {
      const resolverDirPath = path.resolve(
        this.baseDirPath,
        resolversFolderName,
        relationsResolversFolderName,
        relationModelData.model.typeName,
      );

      const fieldsWithArgs = relationModelData.relationFields.filter(
        field => field.argsTypeName,
      );

      fieldsWithArgs.forEach(field => {
        if (!field.argsTypeName) {
          throw new Error(
            `Expected argsTypeName to be defined for relation field after filtering, but got ${field.argsTypeName}`,
          );
        }

        files.push(
          ...generateArgsTypeClassFromArgs(
            resolverDirPath,
            field.outputTypeField.args,
            field.argsTypeName,
            this.dmmfDocument,
          ),
        );
      });

      const argTypeNames = relationModelData.relationFields
        .filter(it => it.argsTypeName !== undefined)
        .map(it => {
          if (!it.argsTypeName) {
            throw new Error(
              `Expected argsTypeName to be defined after filtering, but got ${it.argsTypeName}`,
            );
          }
          return it.argsTypeName;
        });

      if (argTypeNames.length > 0) {
        files.push(
          ...createGeneratedFiles(
            path.resolve(resolverDirPath, argsFolderName, "index"),
            generateArgsBarrelFile(argTypeNames),
          ),
        );
      }
    });

    return files;
  }
}
