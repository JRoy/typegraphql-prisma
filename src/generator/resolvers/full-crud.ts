import path from "node:path";

import { crudResolversFolderName, resolversFolderName } from "../config";
import type { DmmfDocument } from "../dmmf/dmmf-document";
import type { DMMF } from "../dmmf/types";
import type { GeneratorOptions } from "../options";
import {
  buildCrudResolverMethod,
  createGeneratedFiles,
  createImportModuleSpecifier,
  renderResolverModule,
  type GeneratedFile,
  type DtsImport,
} from "../string-emitter";

export default function generateCrudResolverClassFromMapping(
  baseDirPath: string,
  mapping: DMMF.ModelMapping,
  model: DMMF.Model,
  dmmfDocument: DmmfDocument,
  generatorOptions: GeneratorOptions,
): GeneratedFile[] {
  const filePath = path.resolve(
    baseDirPath,
    resolversFolderName,
    crudResolversFolderName,
    model.typeName,
    mapping.resolverName,
  );

  const distinctOutputTypesNames = Array.from(
    new Set(mapping.actions.map(it => it.outputTypeName)),
  );
  const modelOutputTypeNames = distinctOutputTypesNames.filter(typeName =>
    dmmfDocument.isModelTypeName(typeName),
  );
  const otherOutputTypeNames = distinctOutputTypesNames.filter(
    typeName => !dmmfDocument.isModelTypeName(typeName),
  );

  const runtimeRefs = new Map<string, string>();
  const jsImports = [
    {
      alias: "TypeGraphQL",
      moduleSpecifier: "type-graphql",
      kind: "namespace" as const,
    },
    {
      alias: "helpers_1",
      moduleSpecifier: "../../../helpers",
      kind: "named" as const,
      names: [
        "transformInfoIntoPrismaArgs",
        "getPrismaFromContext",
        "transformCountFieldIntoSelectRelationsCount",
      ],
    },
  ];
  const dtsImports: DtsImport[] = [
    {
      moduleSpecifier: "graphql",
      named: ["GraphQLResolveInfo"],
      isTypeOnly: true,
    },
  ];

  for (const argsTypeName of mapping.actions
    .filter(it => it.argsTypeName !== undefined)
    .map(it => it.argsTypeName!)) {
    const alias = `${argsTypeName}_1`;
    jsImports.push({
      alias,
      moduleSpecifier: `./args/${argsTypeName}`,
      kind: "named",
      names: [argsTypeName],
    });
    dtsImports.push({
      moduleSpecifier: `./args/${argsTypeName}`,
      named: [argsTypeName],
    });
    runtimeRefs.set(argsTypeName, `${alias}.${argsTypeName}`);
  }

  for (const typeName of modelOutputTypeNames) {
    const alias = `${typeName}_1`;
    jsImports.push({
      alias,
      moduleSpecifier: createImportModuleSpecifier("models", typeName, 3),
      kind: "named",
      names: [typeName],
    });
    dtsImports.push({
      moduleSpecifier: createImportModuleSpecifier("models", typeName, 3),
      named: [typeName],
    });
    runtimeRefs.set(typeName, `${alias}.${typeName}`);
  }

  for (const typeName of otherOutputTypeNames) {
    const alias = `${typeName}_1`;
    jsImports.push({
      alias,
      moduleSpecifier: createImportModuleSpecifier("outputs", typeName, 2),
      kind: "named",
      names: [typeName],
    });
    dtsImports.push({
      moduleSpecifier: createImportModuleSpecifier("outputs", typeName, 2),
      named: [typeName],
    });
    runtimeRefs.set(typeName, `${alias}.${typeName}`);
  }

  const module = renderResolverModule({
    className: mapping.resolverName,
    modelTypeName: model.typeName,
    modelRuntimeRef: runtimeRefs.get(model.typeName),
    jsImports,
    dtsImports,
    methods: mapping.actions.map(action =>
      buildCrudResolverMethod({
        action,
        mapping,
        generatorOptions,
        runtimeRefs,
      }),
    ),
  });

  return createGeneratedFiles(filePath, module);
}
