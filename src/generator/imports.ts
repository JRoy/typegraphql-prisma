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
  _hasSomeRelations: boolean,
  _blocksToEmit: EmitBlockKind[],
): GeneratedModule {
  return {
    js: '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n',
    dts: "",
  };
}
