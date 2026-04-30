import {
  argsFolderName,
  crudResolversFolderName,
  enumsFolderName,
  inputsFolderName,
  modelsFolderName,
  outputsFolderName,
  relationsResolversFolderName,
  resolversFolderName,
} from "./config";
import { type EmitBlockKind } from "./emit-block";
import type { GenerateMappingData } from "./types";
import { createBarrelModule, type GeneratedModule } from "./string-emitter";

export function generateArgsBarrelFile(
  argsTypeNames: string[],
): GeneratedModule {
  return createBarrelModule(
    argsTypeNames.sort().map(argTypeName => `./${argTypeName}`),
  );
}

export function generateArgsIndexFile(typeNames: string[]): GeneratedModule {
  return createBarrelModule(
    typeNames.sort().map(typeName => `./${typeName}/args`),
  );
}

export function generateModelsBarrelFile(
  modelNames: string[],
): GeneratedModule {
  return createBarrelModule(
    modelNames.sort().map(modelName => `./${modelName}`),
  );
}

export function generateEnumsBarrelFile(
  enumTypeNames: string[],
): GeneratedModule {
  return createBarrelModule(
    enumTypeNames.sort().map(enumTypeName => `./${enumTypeName}`),
  );
}

export function generateInputsBarrelFile(
  inputTypeNames: string[],
): GeneratedModule {
  return createBarrelModule(
    inputTypeNames.sort().map(inputTypeName => `./${inputTypeName}`),
  );
}

export function generateOutputsBarrelFile(
  outputTypeNames: string[],
  hasSomeArgs: boolean,
): GeneratedModule {
  return createBarrelModule([
    ...outputTypeNames.sort().map(outputTypeName => `./${outputTypeName}`),
    ...(hasSomeArgs ? [`./${argsFolderName}`] : []),
  ]);
}

export function generateResolversBarrelFile(
  resolversData: GenerateMappingData[],
): GeneratedModule {
  return createBarrelModule(
    [...resolversData]
      .sort((a, b) =>
        a.modelName > b.modelName ? 1 : a.modelName < b.modelName ? -1 : 0,
      )
      .map(({ modelName, resolverName }) => `./${modelName}/${resolverName}`),
  );
}

export function generateResolversActionsBarrelFile(
  resolversData: GenerateMappingData[],
): GeneratedModule {
  return createBarrelModule(
    [...resolversData]
      .sort((a, b) =>
        a.modelName > b.modelName ? 1 : a.modelName < b.modelName ? -1 : 0,
      )
      .flatMap(({ modelName, actionResolverNames }) =>
        (actionResolverNames ?? []).map(
          actionResolverName => `./${modelName}/${actionResolverName}`,
        ),
      ),
  );
}

export function generateResolversIndexFile(
  type: "crud" | "relations",
  hasSomeArgs: boolean,
): GeneratedModule {
  return createBarrelModule([
    ...(type === "crud"
      ? ["./resolvers-actions.index", "./resolvers-crud.index"]
      : ["./resolvers.index"]),
    ...(hasSomeArgs ? ["./args.index"] : []),
  ]);
}

export function generateIndexFile(
  hasSomeRelations: boolean,
  blocksToEmit: EmitBlockKind[],
): GeneratedModule {
  const shouldEmitCrudResolvers = blocksToEmit.includes("crudResolvers");
  const shouldEmitRelationResolvers =
    hasSomeRelations && blocksToEmit.includes("relationResolvers");

  const jsLines = [
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    ...(shouldEmitCrudResolvers || shouldEmitRelationResolvers
      ? ["exports.resolvers = void 0;"]
      : []),
    ...(shouldEmitCrudResolvers ? ["exports.crudResolvers = void 0;"] : []),
    ...(shouldEmitRelationResolvers
      ? ["exports.relationResolvers = void 0;"]
      : []),
    'const tslib_1 = require("tslib");',
    ...(blocksToEmit.includes("enums")
      ? ['tslib_1.__exportStar(require("./enums"), exports);']
      : []),
    ...(blocksToEmit.includes("models")
      ? ['tslib_1.__exportStar(require("./models"), exports);']
      : []),
    ...(shouldEmitCrudResolvers
      ? [
          `tslib_1.__exportStar(require("./${resolversFolderName}/${crudResolversFolderName}"), exports);`,
          `const crudResolversImport = tslib_1.__importStar(require("./${resolversFolderName}/${crudResolversFolderName}/resolvers-crud.index"));`,
          "exports.crudResolvers = Object.values(crudResolversImport);",
        ]
      : []),
    ...(shouldEmitRelationResolvers
      ? [
          `tslib_1.__exportStar(require("./${resolversFolderName}/${relationsResolversFolderName}"), exports);`,
          `const relationResolversImport = tslib_1.__importStar(require("./${resolversFolderName}/${relationsResolversFolderName}/resolvers.index"));`,
          "exports.relationResolvers = Object.values(relationResolversImport);",
        ]
      : []),
    ...(blocksToEmit.includes("inputs")
      ? [
          `tslib_1.__exportStar(require("./${resolversFolderName}/${inputsFolderName}"), exports);`,
        ]
      : []),
    ...(blocksToEmit.includes("outputs")
      ? [
          `tslib_1.__exportStar(require("./${resolversFolderName}/${outputsFolderName}"), exports);`,
        ]
      : []),
    'tslib_1.__exportStar(require("./enhance"), exports);',
    'tslib_1.__exportStar(require("./scalars"), exports);',
    ...(shouldEmitCrudResolvers || shouldEmitRelationResolvers
      ? [
          `exports.resolvers = [${shouldEmitCrudResolvers ? "...exports.crudResolvers," : ""}${shouldEmitRelationResolvers ? "...exports.relationResolvers," : ""}];`,
        ]
      : []),
  ];

  const dtsLines = [
    ...(blocksToEmit.includes("enums") ? ['export * from "./enums";'] : []),
    ...(blocksToEmit.includes("models") ? ['export * from "./models";'] : []),
    ...(shouldEmitCrudResolvers
      ? [
          `export * from "./${resolversFolderName}/${crudResolversFolderName}";`,
          'import { NonEmptyArray } from "type-graphql";',
          "export declare const crudResolvers: NonEmptyArray<Function>;",
        ]
      : []),
    ...(shouldEmitRelationResolvers
      ? [
          `export * from "./${resolversFolderName}/${relationsResolversFolderName}";`,
          ...(shouldEmitCrudResolvers
            ? []
            : ['import { NonEmptyArray } from "type-graphql";']),
          "export declare const relationResolvers: NonEmptyArray<Function>;",
        ]
      : []),
    ...(blocksToEmit.includes("inputs")
      ? [`export * from "./${resolversFolderName}/${inputsFolderName}";`]
      : []),
    ...(blocksToEmit.includes("outputs")
      ? [`export * from "./${resolversFolderName}/${outputsFolderName}";`]
      : []),
    'export * from "./enhance";',
    'export * from "./scalars";',
    ...(shouldEmitCrudResolvers || shouldEmitRelationResolvers
      ? ["export declare const resolvers: NonEmptyArray<Function>;"]
      : []),
  ];

  return {
    js: `${jsLines.join("\n")}\n`,
    dts: `${dtsLines.join("\n")}\n`,
  };
}
