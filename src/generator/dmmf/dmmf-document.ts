import type { DMMF as PrismaDMMF } from "@prisma/generator-helper";

import type { DMMF } from "./types";
import {
  transformSchema,
  transformMappings,
  transformBareModel,
  transformModelWithFields,
  transformEnums,
  generateRelationModel,
  clearOutputTypeNameCache,
} from "./transform";
import type { GeneratorOptions } from "../options";
import type { EmitBlockKind } from "../emit-block";
import { clearKeywordPositionCache } from "../helpers";

const RESERVED_KEYWORDS: string[] = ["async", "await", "using"];

export class DmmfDocument implements DMMF.Document {
  private readonly models: DMMF.Model[];
  datamodel: DMMF.Datamodel;
  schema: DMMF.Schema;
  enums: DMMF.Enum[];
  modelMappings: DMMF.ModelMapping[];
  relationModels: DMMF.RelationModel[];
  scalarTypeNames: string[];

  outputTypeCache: Map<string, DMMF.OutputType>;
  modelsCache: Map<string, DMMF.Model>;
  modelTypeNameCache: Set<string>;
  fieldAliasCache: Map<string, Map<string, string>>;

  enumsCache: Map<string, DMMF.Enum>;
  enumsByTypeNameCache: Map<string, DMMF.Enum>;
  modelFieldsCache: Map<string, Map<string, any>>;
  outputTypeFieldsCache: Map<string, Map<string, any>>;
  // Reverse index: fieldName → OutputType (eliminates O(n) scan in findOutputTypeWithField)
  fieldToOutputTypeCache: Map<string, DMMF.OutputType>;

  constructor(
    { datamodel, schema, mappings }: PrismaDMMF.Document,
    public options: GeneratorOptions,
  ) {
    clearOutputTypeNameCache();
    clearKeywordPositionCache();

    this.outputTypeCache = new Map();
    this.modelsCache = new Map();
    this.modelTypeNameCache = new Set();
    this.fieldAliasCache = new Map();
    this.enumsCache = new Map();
    this.enumsByTypeNameCache = new Map();
    this.modelFieldsCache = new Map();
    this.outputTypeFieldsCache = new Map();
    this.fieldToOutputTypeCache = new Map();

    const enumTypes = (schema.enumTypes.prisma ?? []).concat(
      schema.enumTypes.model ?? [],
    );
    const models = datamodel.models.concat(datamodel.types);

    // Pass 1: bare models (no fields) — establishes model names + type names
    this.models = models.map(transformBareModel);

    // Pass 2: enums (first pass) — needed before model fields to resolve enum type names
    this.enums = enumTypes.map(transformEnums(this));

    // Pass 3: models with fields — populates caches for field aliases
    this.models = models.map(model => {
      const transformed = transformModelWithFields(this)(model);

      this.modelsCache.set(model.name, transformed);
      this.modelTypeNameCache.add(transformed.typeName);

      const fieldAliases = new Map<string, string>();
      const modelFields = new Map<string, any>();

      for (const field of transformed.fields) {
        modelFields.set(field.name, field);
        if (field.typeFieldAlias) {
          fieldAliases.set(field.name, field.typeFieldAlias);
        }
      }

      this.modelFieldsCache.set(model.name, modelFields);
      if (fieldAliases.size > 0) {
        this.fieldAliasCache.set(model.name, fieldAliases);
      }

      return transformed;
    });

    // Pass 4: enums again — now with field aliases available for value renaming.
    // Populates both name and typeName caches.
    this.enums = enumTypes.map(enumType => {
      const transformed = transformEnums(this)(enumType);
      this.enumsCache.set(enumType.name, transformed);
      this.enumsByTypeNameCache.set(transformed.typeName, transformed);
      return transformed;
    });

    this.datamodel = {
      models: this.models,
      enums: datamodel.enums.map(transformEnums(this)),
      types: [], // TODO: parse `datamodel.types`
    };

    this.schema = {
      ...transformSchema(schema, this),
      enums: this.enums,
    };

    // Build output type caches + reverse field index in a single pass
    for (const outputType of this.schema.outputTypes) {
      this.outputTypeCache.set(outputType.name, outputType);

      const fieldsCache = new Map<string, any>();
      for (const field of outputType.fields) {
        fieldsCache.set(field.name, field);
        // Reverse index: field name → parent output type (for findOutputTypeWithField)
        if (!this.fieldToOutputTypeCache.has(field.name)) {
          this.fieldToOutputTypeCache.set(field.name, outputType);
        }
      }
      this.outputTypeFieldsCache.set(outputType.name, fieldsCache);
    }

    this.modelMappings = transformMappings(
      mappings.modelOperations,
      this,
      options,
    );

    // Optimized relation model computation: single filter pass + Set-based field lookup
    this.relationModels = [];
    for (const model of this.models) {
      const hasRelationField = model.fields.some(
        field => field.relationName !== undefined && !field.isOmitted.output,
      );
      if (!hasRelationField) {
        continue;
      }

      const outputType = this.outputTypeCache.get(model.name);
      if (!outputType) {
        continue;
      }

      // Build a Set of output type field names for O(1) lookups
      const outputFieldNames = this.outputTypeFieldsCache.get(model.name);
      if (!outputFieldNames) {
        continue;
      }

      const hasMatchingRelation = model.fields.some(
        modelField =>
          modelField.relationName !== undefined &&
          !modelField.isOmitted.output &&
          outputFieldNames.has(modelField.name),
      );

      if (hasMatchingRelation) {
        this.relationModels.push(generateRelationModel(this)(model));
      }
    }

    // Collect scalar types in a single pass
    const scalarTypes = new Set<string>();
    for (const inputType of this.schema.inputTypes) {
      for (const field of inputType.fields) {
        if (field.selectedInputType.location === "scalar") {
          scalarTypes.add(field.selectedInputType.type);
        }
      }
    }
    for (const outputType of this.schema.outputTypes) {
      for (const field of outputType.fields) {
        if (field.outputType.location === "scalar") {
          scalarTypes.add(field.outputType.type);
        }
        for (const arg of field.args) {
          if (arg.selectedInputType.location === "scalar") {
            scalarTypes.add(arg.selectedInputType.type);
          }
        }
      }
    }
    this.scalarTypeNames = ["Bytes", "Decimal", ...scalarTypes];
  }

  getModelTypeName(modelName: string): string | undefined {
    const cachedModel = this.modelsCache.get(modelName);
    if (cachedModel) {
      return cachedModel.typeName;
    }
    return this.models.find(
      it => it.name.toLocaleLowerCase() === modelName.toLocaleLowerCase(),
    )?.typeName;
  }

  isModelName(typeName: string): boolean {
    return this.modelsCache.has(typeName);
  }

  isModelTypeName(typeName: string): boolean {
    return this.modelTypeNameCache.has(typeName);
  }

  getModelFieldAlias(modelName: string, fieldName: string): string | undefined {
    return this.fieldAliasCache.get(modelName)?.get(fieldName);
  }

  shouldGenerateBlock(block: EmitBlockKind): boolean {
    return this.options.blocksToEmit.includes(block);
  }

  getEnumByName(name: string): DMMF.Enum | undefined {
    return this.enumsCache.get(name);
  }

  getEnumByTypeName(typeName: string): DMMF.Enum | undefined {
    return this.enumsByTypeNameCache.get(typeName);
  }

  getEnumByTypeNameOrName(nameOrTypeName: string): DMMF.Enum | undefined {
    return (
      this.enumsCache.get(nameOrTypeName) ??
      this.enumsByTypeNameCache.get(nameOrTypeName)
    );
  }

  getModelField(modelName: string, fieldName: string): any | undefined {
    return this.modelFieldsCache.get(modelName)?.get(fieldName);
  }

  getOutputTypeField(
    outputTypeName: string,
    fieldName: string,
  ): any | undefined {
    return this.outputTypeFieldsCache.get(outputTypeName)?.get(fieldName);
  }

  findOutputTypeWithField(fieldName: string): DMMF.OutputType | undefined {
    return this.fieldToOutputTypeCache.get(fieldName);
  }
}
