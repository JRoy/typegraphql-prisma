import path from "node:path";

import { camelCase } from "../helpers";
import {
  outputsFolderName,
  relationsResolversFolderName,
  resolversFolderName,
} from "../config";
import type { DmmfDocument } from "../dmmf/dmmf-document";
import type { DMMF } from "../dmmf/types";
import type { GeneratorOptions } from "../options";
import {
  buildCountResolverMethod,
  buildRelationResolverMethod,
  createGeneratedFiles,
  createImportModuleSpecifier,
  renderResolverModule,
  type GeneratedFile,
  type DtsImport,
  type RelationBatchPlan,
} from "../string-emitter";

/**
 * How a relation field can be resolved with a batched key lookup on the
 * related model: `relatedModel.findMany({ where: { [targetField]: { in } } })`,
 * keyed by `root[rootField]`. Only single-column keys qualify; composite keys
 * and implicit many-to-many relations keep the fluent API.
 */
function getRelationBatchPlan(
  dmmfDocument: DmmfDocument,
  model: DMMF.Model,
  field: DMMF.RelationField,
): RelationBatchPlan | undefined {
  const relatedModel = dmmfDocument.datamodel.models.find(
    it => it.typeName === field.type,
  );
  if (!relatedModel) {
    return undefined;
  }
  const delegateName = camelCase(relatedModel.name);

  if (
    !field.isList &&
    field.relationFromFields?.length === 1 &&
    field.relationToFields?.length === 1
  ) {
    return {
      delegateName,
      rootField: field.relationFromFields[0],
      targetField: field.relationToFields[0],
      isList: false,
    };
  }

  const oppositeField = relatedModel.fields.find(
    it =>
      it.relationName === field.relationName &&
      !(relatedModel.name === model.name && it.name === field.name),
  );
  if (
    oppositeField?.relationFromFields?.length === 1 &&
    oppositeField.relationToFields?.length === 1
  ) {
    return {
      delegateName,
      rootField: oppositeField.relationToFields[0],
      targetField: oppositeField.relationFromFields[0],
      isList: field.isList,
    };
  }

  return undefined;
}

export default function generateRelationsResolverClassesFromModel(
  baseDirPath: string,
  dmmfDocument: DmmfDocument,
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
        "extractCountFieldFromInfo",
        ...(generatorOptions.batchRelationResolvers ? ["batchedFindMany"] : []),
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

  const countOutputType = dmmfDocument.shouldGenerateBlock("crudResolvers")
    ? undefined
    : dmmfDocument.getCountOutputType(model.name);
  if (countOutputType) {
    const alias = `${countOutputType.typeName}_1`;
    jsImports.push({
      alias,
      moduleSpecifier: createImportModuleSpecifier(
        outputsFolderName,
        countOutputType.typeName,
        2,
      ),
      kind: "named",
      names: [countOutputType.typeName],
    });
    dtsImports.push({
      moduleSpecifier: createImportModuleSpecifier(
        outputsFolderName,
        countOutputType.typeName,
        2,
      ),
      named: [countOutputType.typeName],
    });
    runtimeRefs.set(
      countOutputType.typeName,
      `${alias}.${countOutputType.typeName}`,
    );
  }

  const module = renderResolverModule({
    className: resolverName,
    modelTypeName: model.typeName,
    modelRuntimeRef: runtimeRefs.get(model.typeName),
    jsImports,
    dtsImports,
    methods: [
      ...relationFields.map(field =>
        buildRelationResolverMethod({
          field,
          modelTypeName: model.typeName,
          rootArgName,
          whereCondition: whereConditionString,
          generatorOptions,
          runtimeRefs,
          batchPlan: generatorOptions.batchRelationResolvers
            ? getRelationBatchPlan(dmmfDocument, model, field)
            : undefined,
        }),
      ),
      ...(countOutputType
        ? [
            buildCountResolverMethod({
              countOutputTypeName: countOutputType.typeName,
              modelTypeName: model.typeName,
              modelName: model.name,
              rootArgName,
              whereCondition: whereConditionString,
              runtimeRefs,
            }),
          ]
        : []),
    ],
  });

  return createGeneratedFiles(filePath, module);
}
