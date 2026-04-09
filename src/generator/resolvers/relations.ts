import path from "node:path";

import { camelCase } from "../helpers";
import { relationsResolversFolderName, resolversFolderName } from "../config";
import type { DmmfDocument } from "../dmmf/dmmf-document";
import type { DMMF } from "../dmmf/types";
import type { GeneratorOptions } from "../options";
import {
  buildRelationResolverMethod,
  createGeneratedFiles,
  createImportModuleSpecifier,
  renderResolverModule,
  type GeneratedFile,
  type DtsImport,
} from "../string-emitter";

export default function generateRelationsResolverClassesFromModel(
  baseDirPath: string,
  _dmmfDocument: DmmfDocument,
  { model, relationFields, resolverName }: DMMF.RelationModel,
  generatorOptions: GeneratorOptions,
): GeneratedFile[] {
  const rootArgName = camelCase(model.typeName);
  const fieldsCache = new Map<string, DMMF.ModelField>();
  let singleIdField: DMMF.ModelField | undefined;
  let singleUniqueField: DMMF.ModelField | undefined;

  model.fields.forEach(field => {
    fieldsCache.set(field.name, field);
    if (field.isId && !singleIdField) {
      singleIdField = field;
    }
    if (field.isUnique && !singleUniqueField) {
      singleUniqueField = field;
    }
  });

  const singleFilterField = singleIdField ?? singleUniqueField;
  const compositeIdFields =
    model.primaryKey?.fields.map(idField => {
      const field = fieldsCache.get(idField);
      if (!field) {
        throw new Error(
          `Primary key field '${idField}' not found in model '${model.name}' fields`,
        );
      }
      return field;
    }) ?? [];
  const compositeUniqueFields = model.uniqueIndexes[0]
    ? model.uniqueIndexes[0].fields.map(uniqueField => {
        const field = fieldsCache.get(uniqueField);
        if (!field) {
          throw new Error(
            `Unique field '${uniqueField}' not found in model '${model.name}' fields`,
          );
        }
        return field;
      })
    : [];
  const compositeFilterFields =
    compositeIdFields.length > 0 ? compositeIdFields : compositeUniqueFields;

  const resolverDirPath = path.resolve(
    baseDirPath,
    resolversFolderName,
    relationsResolversFolderName,
    model.typeName,
  );
  const filePath = path.resolve(resolverDirPath, resolverName);

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

  for (const typeName of [
    ...relationFields.map(field => field.type),
    model.typeName,
  ]) {
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

  for (const argsTypeName of relationFields
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

  const module = renderResolverModule({
    className: resolverName,
    modelTypeName: model.typeName,
    modelRuntimeRef: runtimeRefs.get(model.typeName),
    jsImports,
    dtsImports,
    methods: relationFields.map(field => {
      let whereConditionString = "";
      if (singleFilterField) {
        whereConditionString = `${singleFilterField.name}: ${rootArgName}.${singleFilterField.name},`;
      } else if (compositeFilterFields.length > 0) {
        const filterKeyName =
          model.primaryKey?.name ??
          model.uniqueIndexes[0]?.name ??
          compositeFilterFields.map(it => it.name).join("_");
        whereConditionString = [
          `${filterKeyName}: {`,
          ...compositeFilterFields.map(
            idField => `  ${idField.name}: ${rootArgName}.${idField.name},`,
          ),
          "},",
        ].join("\n");
      } else {
        throw new Error(
          `Unexpected error happened on generating 'whereConditionString' for ${model.typeName} relation resolver`,
        );
      }

      return buildRelationResolverMethod({
        field,
        modelTypeName: model.typeName,
        rootArgName,
        whereCondition: whereConditionString,
        generatorOptions,
        runtimeRefs,
      });
    }),
  });

  return createGeneratedFiles(filePath, module);
}
