import {
  crudResolversFolderName,
  inputsFolderName,
  modelsFolderName,
  outputsFolderName,
  relationsResolversFolderName,
  resolversFolderName,
  supportedMutationActions,
} from "./config";
import type { DmmfDocument } from "./dmmf/dmmf-document";
import type { DMMF } from "./dmmf/types";
import type { GeneratedModule } from "./string-emitter";

export function generateEnhanceMap(
  dmmfDocument: DmmfDocument,
  modelMappings: readonly DMMF.ModelMapping[],
  relationModels: readonly DMMF.RelationModel[],
  models: readonly DMMF.Model[],
  inputs: readonly DMMF.InputType[],
  outputs: readonly DMMF.OutputType[],
): GeneratedModule {
  const hasRelations = relationModels.length > 0;
  const emitCrudResolvers = dmmfDocument.shouldGenerateBlock("crudResolvers");
  const emitRelationResolvers =
    hasRelations && dmmfDocument.shouldGenerateBlock("relationResolvers");
  const emitModels = dmmfDocument.shouldGenerateBlock("models");
  const emitOutputs = dmmfDocument.shouldGenerateBlock("outputs");
  const emitInputs = dmmfDocument.shouldGenerateBlock("inputs");

  const jsLines = [
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    "exports.applyInputTypesEnhanceMap = applyInputTypesEnhanceMap;",
    "exports.applyOutputTypesEnhanceMap = applyOutputTypesEnhanceMap;",
    "exports.applyModelsEnhanceMap = applyModelsEnhanceMap;",
    "exports.applyRelationResolversEnhanceMap = applyRelationResolversEnhanceMap;",
    "exports.applyArgsTypesEnhanceMap = applyArgsTypesEnhanceMap;",
    "exports.applyResolversEnhanceMap = applyResolversEnhanceMap;",
    'const tslib_1 = require("tslib");',
    ...(emitCrudResolvers
      ? [
          `const crudResolvers = tslib_1.__importStar(require("./${resolversFolderName}/${crudResolversFolderName}/resolvers-crud.index"));`,
          `const argsTypes = tslib_1.__importStar(require("./${resolversFolderName}/${crudResolversFolderName}/args.index"));`,
          `const actionResolvers = tslib_1.__importStar(require("./${resolversFolderName}/${crudResolversFolderName}/resolvers-actions.index"));`,
          `const crudResolversMap = ${renderJsObject(
            Object.fromEntries(
              modelMappings.map(mapping => [
                mapping.modelTypeName,
                `crudResolvers.${mapping.resolverName}`,
              ]),
            ),
          )};`,
          `const actionResolversMap = ${renderJsObject(
            Object.fromEntries(
              modelMappings.map(mapping => [
                mapping.modelTypeName,
                renderJsObject(
                  Object.fromEntries(
                    mapping.actions.map(action => [
                      action.name,
                      `actionResolvers.${action.actionResolverName}`,
                    ]),
                  ),
                ),
              ]),
            ),
          )};`,
          `const crudResolversInfo = ${renderJsObject(
            Object.fromEntries(
              modelMappings.map(mapping => [
                mapping.modelTypeName,
                `[${mapping.actions.map(action => JSON.stringify(action.name)).join(", ")}]`,
              ]),
            ),
          )};`,
          `const argsInfo = ${renderJsObject(
            Object.fromEntries(
              modelMappings
                .flatMap(it => it.actions)
                .filter(it => it.argsTypeName)
                .map(action => [
                  action.argsTypeName!,
                  `[${action.method.args.map(arg => JSON.stringify(arg.typeName)).join(", ")}]`,
                ]),
            ),
          )};`,
          `function applyResolversEnhanceMap(resolversEnhanceMap) {`,
          `    const mutationOperationPrefixes = [${supportedMutationActions.map(it => JSON.stringify(it)).join(", ")}];`,
          "    for (const modelName of Object.keys(resolversEnhanceMap)) {",
          "        const crudTarget = crudResolversMap[modelName].prototype;",
          "        const resolverActionsConfig = resolversEnhanceMap[modelName];",
          "        const actionResolversConfig = actionResolversMap[modelName];",
          "        const allActionsDecorators = resolverActionsConfig?._all;",
          "        const resolverActionNames = crudResolversInfo[modelName];",
          "        for (const resolverActionName of resolverActionNames) {",
          "            const maybeDecoratorsOrFn = resolverActionsConfig?.[resolverActionName];",
          "            const isWriteOperation = mutationOperationPrefixes.some(prefix => resolverActionName.startsWith(prefix));",
          "            const operationKindDecorators = isWriteOperation ? resolverActionsConfig?._mutation : resolverActionsConfig?._query;",
          "            const mainDecorators = [...(allActionsDecorators ?? []), ...(operationKindDecorators ?? [])];",
          '            const decorators = typeof maybeDecoratorsOrFn === "function" ? maybeDecoratorsOrFn(mainDecorators) : [...mainDecorators, ...(maybeDecoratorsOrFn ?? [])];',
          "            const actionTarget = actionResolversConfig[resolverActionName].prototype;",
          "            tslib_1.__decorate(decorators, crudTarget, resolverActionName, null);",
          "            tslib_1.__decorate(decorators, actionTarget, resolverActionName, null);",
          "        }",
          "    }",
          "}",
          "function applyArgsTypesEnhanceMap(argsTypesEnhanceMap) {",
          "    for (const argsTypeName of Object.keys(argsTypesEnhanceMap)) {",
          "        const typeConfig = argsTypesEnhanceMap[argsTypeName];",
          "        const typeClass = argsTypes[argsTypeName];",
          "        applyTypeClassEnhanceConfig(typeConfig, typeClass, typeClass.prototype, argsInfo[argsTypeName]);",
          "    }",
          "}",
        ]
      : [
          "function applyResolversEnhanceMap(_resolversEnhanceMap) {}",
          "function applyArgsTypesEnhanceMap(_argsTypesEnhanceMap) {}",
        ]),
    ...(emitRelationResolvers
      ? [
          `const relationResolvers = tslib_1.__importStar(require("./${resolversFolderName}/${relationsResolversFolderName}/resolvers.index"));`,
          `const relationResolversMap = ${renderJsObject(
            Object.fromEntries(
              relationModels.map(relationModel => [
                relationModel.model.typeName,
                `relationResolvers.${relationModel.resolverName}`,
              ]),
            ),
          )};`,
          `const relationResolversInfo = ${renderJsObject(
            Object.fromEntries(
              relationModels.map(relationModel => [
                relationModel.model.typeName,
                `[${relationModel.relationFields.map(field => JSON.stringify(field.name)).join(", ")}]`,
              ]),
            ),
          )};`,
          "function applyRelationResolversEnhanceMap(relationResolversEnhanceMap) {",
          "    for (const modelName of Object.keys(relationResolversEnhanceMap)) {",
          "        const relationResolverTarget = relationResolversMap[modelName].prototype;",
          "        const relationResolverActionsConfig = relationResolversEnhanceMap[modelName];",
          "        const allActionsDecorators = relationResolverActionsConfig?._all ?? [];",
          "        const relationResolverActionNames = relationResolversInfo[modelName];",
          "        for (const relationResolverActionName of relationResolverActionNames) {",
          "            const maybeDecoratorsOrFn = relationResolverActionsConfig?.[relationResolverActionName];",
          '            const decorators = typeof maybeDecoratorsOrFn === "function" ? maybeDecoratorsOrFn(allActionsDecorators) : [...allActionsDecorators, ...(maybeDecoratorsOrFn ?? [])];',
          "            tslib_1.__decorate(decorators, relationResolverTarget, relationResolverActionName, null);",
          "        }",
          "    }",
          "}",
        ]
      : [
          "function applyRelationResolversEnhanceMap(_relationResolversEnhanceMap) {}",
        ]),
    ...(emitModels || emitOutputs || emitInputs
      ? [
          "function applyTypeClassEnhanceConfig(enhanceConfig, typeClass, typePrototype, typeFieldNames) {",
          "    if (enhanceConfig?.class) {",
          "        tslib_1.__decorate(enhanceConfig.class, typeClass);",
          "    }",
          "    if (enhanceConfig?.fields) {",
          "        const allFieldsDecorators = enhanceConfig.fields._all ?? [];",
          "        for (const typeFieldName of typeFieldNames) {",
          "            const maybeDecoratorsOrFn = enhanceConfig.fields[typeFieldName];",
          '            const decorators = typeof maybeDecoratorsOrFn === "function" ? maybeDecoratorsOrFn(allFieldsDecorators) : [...allFieldsDecorators, ...(maybeDecoratorsOrFn ?? [])];',
          "            tslib_1.__decorate(decorators, typePrototype, typeFieldName, void 0);",
          "        }",
          "    }",
          "}",
        ]
      : ["function applyTypeClassEnhanceConfig() {}"]),
    ...(emitModels
      ? [
          `const models = tslib_1.__importStar(require("./${modelsFolderName}"));`,
          `const modelsInfo = ${renderJsObject(
            Object.fromEntries(
              models.map(model => [
                model.typeName,
                `[${model.fields
                  .filter(
                    field => !field.relationName && !field.isOmitted.output,
                  )
                  .map(field =>
                    JSON.stringify(field.typeFieldAlias ?? field.name),
                  )
                  .join(", ")}]`,
              ]),
            ),
          )};`,
          "function applyModelsEnhanceMap(modelsEnhanceMap) {",
          "    for (const modelName of Object.keys(modelsEnhanceMap)) {",
          "        const modelConfig = modelsEnhanceMap[modelName];",
          "        const modelClass = models[modelName];",
          "        applyTypeClassEnhanceConfig(modelConfig, modelClass, modelClass.prototype, modelsInfo[modelName]);",
          "    }",
          "}",
        ]
      : ["function applyModelsEnhanceMap(_modelsEnhanceMap) {}"]),
    ...(emitOutputs
      ? [
          `const outputTypes = tslib_1.__importStar(require("./${resolversFolderName}/${outputsFolderName}"));`,
          `const outputsInfo = ${renderJsObject(
            Object.fromEntries(
              outputs.map(output => [
                output.typeName,
                `[${output.fields.map(field => JSON.stringify(field.name)).join(", ")}]`,
              ]),
            ),
          )};`,
          "function applyOutputTypesEnhanceMap(outputTypesEnhanceMap) {",
          "    for (const outputTypeName of Object.keys(outputTypesEnhanceMap)) {",
          "        const typeConfig = outputTypesEnhanceMap[outputTypeName];",
          "        const typeClass = outputTypes[outputTypeName];",
          "        applyTypeClassEnhanceConfig(typeConfig, typeClass, typeClass.prototype, outputsInfo[outputTypeName]);",
          "    }",
          "}",
        ]
      : ["function applyOutputTypesEnhanceMap(_outputTypesEnhanceMap) {}"]),
    ...(emitInputs
      ? [
          `const inputTypes = tslib_1.__importStar(require("./${resolversFolderName}/${inputsFolderName}"));`,
          `const inputsInfo = ${renderJsObject(
            Object.fromEntries(
              inputs.map(input => [
                input.typeName,
                `[${input.fields.map(field => JSON.stringify(field.typeName)).join(", ")}]`,
              ]),
            ),
          )};`,
          "function applyInputTypesEnhanceMap(inputTypesEnhanceMap) {",
          "    for (const inputTypeName of Object.keys(inputTypesEnhanceMap)) {",
          "        const typeConfig = inputTypesEnhanceMap[inputTypeName];",
          "        const typeClass = inputTypes[inputTypeName];",
          "        applyTypeClassEnhanceConfig(typeConfig, typeClass, typeClass.prototype, inputsInfo[inputTypeName]);",
          "    }",
          "}",
        ]
      : ["function applyInputTypesEnhanceMap(_inputTypesEnhanceMap) {}"]),
  ];

  const dtsLines = [
    'import type { ClassType, NonEmptyArray } from "type-graphql";',
    "export type MethodDecoratorOverrideFn = (decorators: MethodDecorator[]) => MethodDecorator[];",
    "export type PropertyDecoratorOverrideFn = (decorators: PropertyDecorator[]) => PropertyDecorator[];",
    "export type FieldsConfig<TTypeKeys extends string = string> = Partial<Record<TTypeKeys, PropertyDecorator[] | PropertyDecoratorOverrideFn>> & { _all?: PropertyDecorator[] };",
    "export type TypeConfig = {",
    "    class?: ClassDecorator[];",
    "    fields?: FieldsConfig;",
    "};",
    "export type ResolverActionsConfig<TModel extends string = string> = Partial<Record<string, MethodDecorator[] | MethodDecoratorOverrideFn>> & {",
    "    _all?: MethodDecorator[];",
    "    _query?: MethodDecorator[];",
    "    _mutation?: MethodDecorator[];",
    "};",
    "export type ResolversEnhanceMap = Record<string, ResolverActionsConfig | undefined>;",
    "export type ArgConfig<TArgsType extends string = string> = {",
    "    class?: ClassDecorator[];",
    "    fields?: FieldsConfig<TArgsType>;",
    "};",
    "export type ArgsTypesEnhanceMap = Record<string, ArgConfig | undefined>;",
    "export type RelationResolverActionsConfig<TModel extends string = string> = Partial<Record<string, MethodDecorator[] | MethodDecoratorOverrideFn>> & { _all?: MethodDecorator[] };",
    "export type RelationResolversEnhanceMap = Record<string, RelationResolverActionsConfig | undefined>;",
    "export type ModelConfig<TModel extends string = string> = {",
    "    class?: ClassDecorator[];",
    "    fields?: FieldsConfig<TModel>;",
    "};",
    "export type ModelsEnhanceMap = Record<string, ModelConfig | undefined>;",
    "export type OutputTypeConfig<TOutput extends string = string> = {",
    "    class?: ClassDecorator[];",
    "    fields?: FieldsConfig<TOutput>;",
    "};",
    "export type OutputTypesEnhanceMap = Record<string, OutputTypeConfig | undefined>;",
    "export type InputTypeConfig<TInput extends string = string> = {",
    "    class?: ClassDecorator[];",
    "    fields?: FieldsConfig<TInput>;",
    "};",
    "export type InputTypesEnhanceMap = Record<string, InputTypeConfig | undefined>;",
    "export declare function applyResolversEnhanceMap(resolversEnhanceMap: ResolversEnhanceMap): void;",
    "export declare function applyArgsTypesEnhanceMap(argsTypesEnhanceMap: ArgsTypesEnhanceMap): void;",
    "export declare function applyRelationResolversEnhanceMap(relationResolversEnhanceMap: RelationResolversEnhanceMap): void;",
    "export declare function applyModelsEnhanceMap(modelsEnhanceMap: ModelsEnhanceMap): void;",
    "export declare function applyOutputTypesEnhanceMap(outputTypesEnhanceMap: OutputTypesEnhanceMap): void;",
    "export declare function applyInputTypesEnhanceMap(inputTypesEnhanceMap: InputTypesEnhanceMap): void;",
  ];

  return {
    js: `${jsLines.join("\n")}\n`,
    dts: `${dtsLines.join("\n")}\n`,
  };
}

function renderJsObject(entries: Record<string, string>): string {
  return `{ ${Object.entries(entries)
    .map(([key, value]) => `${JSON.stringify(key)}: ${value}`)
    .join(", ")} }`;
}
