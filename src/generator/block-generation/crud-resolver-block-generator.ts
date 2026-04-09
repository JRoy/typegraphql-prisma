import path from "node:path";
import { performance } from "node:perf_hooks";

import generateArgsTypeClassFromArgs from "../args-class";
import {
  argsFolderName,
  crudResolversFolderName,
  resolversFolderName,
} from "../config";
import {
  generateArgsBarrelFile,
  generateArgsIndexFile,
  generateResolversActionsBarrelFile,
  generateResolversBarrelFile,
  generateResolversIndexFile,
} from "../imports";
import generateActionResolverClass from "../resolvers/separate-action";
import generateCrudResolverClassFromMapping from "../resolvers/full-crud";
import { createGeneratedFiles } from "../string-emitter";
import type { GenerateMappingData } from "../types";
import {
  BaseBlockGenerator,
  type GenerationResult,
} from "./base-block-generator";

export class CrudResolverBlockGenerator extends BaseBlockGenerator {
  protected shouldGenerate(): boolean {
    return this.dmmfDocument.shouldGenerateBlock("crudResolvers");
  }

  public getBlockName(): string {
    return "crudResolvers";
  }

  public async generate(): Promise<GenerationResult> {
    if (!this.shouldGenerate()) {
      return { files: [], itemsGenerated: 0 };
    }

    const startTime = performance.now();
    let totalItemsGenerated = 0;
    const files = [] as ReturnType<typeof createGeneratedFiles>;

    this.dmmfDocument.modelMappings.forEach(mapping => {
      const model = this.dmmfDocument.modelsCache.get(mapping.modelName);
      if (!model) {
        throw new Error(
          `No model found for mapping ${mapping.modelName}. This indicates a problem with the DMMF document processing.`,
        );
      }

      files.push(
        ...generateCrudResolverClassFromMapping(
          this.baseDirPath,
          mapping,
          model,
          this.dmmfDocument,
          this.options,
        ),
      );
      totalItemsGenerated++;

      mapping.actions.forEach(action => {
        files.push(
          ...generateActionResolverClass(
            this.baseDirPath,
            model,
            action,
            mapping,
            this.dmmfDocument,
            this.options,
          ),
        );
        totalItemsGenerated++;
      });
    });

    files.push(...this.generateBarrelFiles());
    files.push(...this.generateArgs());

    return {
      files,
      itemsGenerated: totalItemsGenerated,
      timeElapsed: performance.now() - startTime,
    };
  }

  private generateBarrelFiles() {
    const generateMappingData = this.dmmfDocument.modelMappings.map(mapping => {
      const model = this.dmmfDocument.modelsCache.get(mapping.modelName);
      if (!model) {
        throw new Error(
          `No model found for mapping ${mapping.modelName} when generating mapping data. This indicates a problem with the DMMF document processing.`,
        );
      }

      return {
        modelName: model.typeName,
        resolverName: mapping.resolverName,
        actionResolverNames: mapping.actions.map(it => it.actionResolverName),
      } as GenerateMappingData;
    });

    return [
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          crudResolversFolderName,
          "resolvers-crud.index",
        ),
        generateResolversBarrelFile(generateMappingData),
      ),
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          crudResolversFolderName,
          "resolvers-actions.index",
        ),
        generateResolversActionsBarrelFile(generateMappingData),
      ),
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          crudResolversFolderName,
          "index",
        ),
        generateResolversIndexFile("crud", true),
      ),
    ];
  }

  private generateArgs() {
    const files = [] as ReturnType<typeof createGeneratedFiles>;

    this.dmmfDocument.modelMappings.forEach(mapping => {
      const actionsWithArgs = mapping.actions.filter(
        it => it.argsTypeName !== undefined,
      );

      if (actionsWithArgs.length === 0) {
        return;
      }

      const model = this.dmmfDocument.modelsCache.get(mapping.modelName);
      if (!model) {
        throw new Error(
          `No model found for mapping ${mapping.modelName} when generating CRUD resolver args. This indicates a problem with the DMMF document processing.`,
        );
      }

      const resolverDirPath = path.resolve(
        this.baseDirPath,
        resolversFolderName,
        crudResolversFolderName,
        model.typeName,
      );

      actionsWithArgs.forEach(action => {
        if (!action.argsTypeName) {
          throw new Error(
            `Expected argsTypeName to be defined for CRUD action after filtering, but got ${action.argsTypeName}`,
          );
        }

        files.push(
          ...generateArgsTypeClassFromArgs(
            resolverDirPath,
            action.method.args,
            action.argsTypeName,
            this.dmmfDocument,
          ),
        );
      });

      files.push(
        ...createGeneratedFiles(
          path.resolve(resolverDirPath, argsFolderName, "index"),
          generateArgsBarrelFile(
            actionsWithArgs.map(it => {
              if (!it.argsTypeName) {
                throw new Error(
                  `Expected argsTypeName to be defined for CRUD action after filtering, but got ${it.argsTypeName}`,
                );
              }
              return it.argsTypeName;
            }),
          ),
        ),
      );
    });

    files.push(
      ...createGeneratedFiles(
        path.resolve(
          this.baseDirPath,
          resolversFolderName,
          crudResolversFolderName,
          "args.index",
        ),
        generateArgsIndexFile(
          this.dmmfDocument.modelMappings
            .filter(mapping =>
              mapping.actions.some(it => it.argsTypeName !== undefined),
            )
            .map(mapping => mapping.modelTypeName),
        ),
      ),
    );

    return files;
  }
}
