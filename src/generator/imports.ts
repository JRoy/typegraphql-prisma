import {
  crudResolversFolderName,
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
    { lazy: true },
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
    { lazy: true },
  );
}

export function generateEnumsBarrelFile(
  enumTypeNames: string[],
): GeneratedModule {
  return createBarrelModule(
    enumTypeNames.sort().map(enumTypeName => `./${enumTypeName}`),
    { lazy: true },
  );
}

export function generateInputsBarrelFile(
  inputTypeNames: string[],
): GeneratedModule {
  return {
    js: '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n',
    dts: "",
  };
}

export function generateOutputsBarrelFile(
  _outputTypeNames: string[],
  _hasSomeArgs: boolean,
): GeneratedModule {
  return {
    js: '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n',
    dts: "",
  };
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
    { lazy: true },
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
    { lazy: true },
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
          "let crudResolversCache;",
          `Object.defineProperty(exports, "crudResolvers", { enumerable: true, get: function () { return crudResolversCache ?? (crudResolversCache = Object.values(tslib_1.__importStar(require("./${resolversFolderName}/${crudResolversFolderName}/resolvers-crud.index")))); } });`,
        ]
      : []),
    ...(shouldEmitRelationResolvers
      ? [
          `tslib_1.__exportStar(require("./${resolversFolderName}/${relationsResolversFolderName}"), exports);`,
          "let relationResolversCache;",
          `Object.defineProperty(exports, "relationResolvers", { enumerable: true, get: function () { return relationResolversCache ?? (relationResolversCache = Object.values(tslib_1.__importStar(require("./${resolversFolderName}/${relationsResolversFolderName}/resolvers.index")))); } });`,
        ]
      : []),
    'tslib_1.__exportStar(require("./scalars"), exports);',
    ...(shouldEmitCrudResolvers || shouldEmitRelationResolvers
      ? [
          `Object.defineProperty(exports, "resolvers", { enumerable: true, get: function () { return [${shouldEmitCrudResolvers ? "...exports.crudResolvers," : ""}${shouldEmitRelationResolvers ? "...exports.relationResolvers," : ""}]; } });`,
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
