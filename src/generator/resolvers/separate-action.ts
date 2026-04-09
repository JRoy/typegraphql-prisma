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

export default function generateActionResolverClass(
  baseDirPath: string,
  model: DMMF.Model,
  action: DMMF.Action,
  mapping: DMMF.ModelMapping,
  dmmfDocument: DmmfDocument,
  generatorOptions: GeneratorOptions,
): GeneratedFile[] {
  const filePath = path.resolve(
    baseDirPath,
    resolversFolderName,
    crudResolversFolderName,
    model.typeName,
    action.actionResolverName,
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

  if (action.argsTypeName) {
    const alias = `${action.argsTypeName}_1`;
    jsImports.push({
      alias,
      moduleSpecifier: `./args/${action.argsTypeName}`,
      kind: "named",
      names: [action.argsTypeName],
    });
    dtsImports.push({
      moduleSpecifier: `./args/${action.argsTypeName}`,
      named: [action.argsTypeName],
    });
    runtimeRefs.set(action.argsTypeName, `${alias}.${action.argsTypeName}`);
  }

  for (const typeName of [model.typeName, action.outputTypeName].filter(
    typeName => dmmfDocument.isModelTypeName(typeName),
  )) {
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

  if (!dmmfDocument.isModelTypeName(action.outputTypeName)) {
    const alias = `${action.outputTypeName}_1`;
    jsImports.push({
      alias,
      moduleSpecifier: createImportModuleSpecifier(
        "outputs",
        action.outputTypeName,
        2,
      ),
      kind: "named",
      names: [action.outputTypeName],
    });
    dtsImports.push({
      moduleSpecifier: createImportModuleSpecifier(
        "outputs",
        action.outputTypeName,
        2,
      ),
      named: [action.outputTypeName],
    });
    runtimeRefs.set(action.outputTypeName, `${alias}.${action.outputTypeName}`);
  }

  const module = renderResolverModule({
    className: action.actionResolverName,
    modelTypeName: model.typeName,
    modelRuntimeRef: runtimeRefs.get(model.typeName),
    jsImports,
    dtsImports,
    methods: [
      buildCrudResolverMethod({
        action,
        mapping,
        generatorOptions,
        runtimeRefs,
      }),
    ],
  });

  return createGeneratedFiles(filePath, module);
}
