import path from "node:path";

import {
  argsFolderName,
  enumsFolderName,
  inputsFolderName,
  modelsFolderName,
  outputsFolderName,
  resolversFolderName,
} from "./config";
import { cleanDocsString, pascalCase } from "./helpers";
import type { DmmfDocument } from "./dmmf/dmmf-document";
import { DMMF } from "./dmmf/types";
import type { GeneratorOptions } from "./options";

export interface GeneratedFile {
  filePath: string;
  content: string;
}

export interface GeneratedModule {
  js: string;
  dts: string;
}

interface JSImport {
  alias: string;
  moduleSpecifier: string;
  kind: "default" | "named" | "namespace";
  names?: string[];
}

export interface DtsImport {
  moduleSpecifier: string;
  named?: string[];
  namespace?: string;
  isTypeOnly?: boolean;
}

interface PropertyDecoratorSpec {
  runtimeType: string;
  decorator: string;
  targetName: string;
  propertyName: string;
  isAccessor?: boolean;
}

interface MethodDecoratorSpec {
  decorator: string;
  targetName: string;
  propertyName: string;
  paramDecorators?: string[];
  paramTypes?: string[];
  returnType?: string;
}

export function createGeneratedFiles(
  filePathWithoutExtension: string,
  module: GeneratedModule,
): GeneratedFile[] {
  return [
    {
      filePath: `${filePathWithoutExtension}.js`,
      content: module.js,
    },
    {
      filePath: `${filePathWithoutExtension}.d.ts`,
      content: module.dts,
    },
  ];
}

export function createBarrelModule(
  moduleSpecifiers: string[],
): GeneratedModule {
  const sortedSpecifiers = [...moduleSpecifiers].sort();
  const jsLines = [
    renderJsHeader(),
    'const tslib_1 = require("tslib");',
    ...sortedSpecifiers.map(
      moduleSpecifier =>
        `tslib_1.__exportStar(require(${JSON.stringify(moduleSpecifier)}), exports);`,
    ),
  ];

  const dtsLines = sortedSpecifiers.map(
    moduleSpecifier => `export * from ${JSON.stringify(moduleSpecifier)};`,
  );

  return {
    js: withTrailingNewline(jsLines.join("\n")),
    dts: withTrailingNewline(dtsLines.join("\n")),
  };
}

export function createImportModuleSpecifier(
  directoryName: string,
  elementName: string,
  level = 1,
): string {
  return (
    (level === 0 ? "./" : "") +
    path.posix.join(...Array(level).fill(".."), directoryName, elementName)
  );
}

export function createPrismaModuleSpecifier(
  options: GeneratorOptions,
  level = 0,
): string {
  const prismaImportPath =
    options.customPrismaImportPath ??
    path.posix.join(options.relativePrismaOutputPath, "client");

  return (
    options.absolutePrismaOutputPath ??
    (level === 0 ? "./" : "") +
      path.posix.join(...Array(level).fill(".."), prismaImportPath)
  );
}

export function emitInputTypeModule(
  inputType: DMMF.InputType,
  options: GeneratorOptions,
): GeneratedModule {
  const fieldsToEmit = inputType.fields.filter(field => !field.isOmitted);
  const mappedFields = fieldsToEmit.filter(field => field.hasMappedName);

  const jsImports: JSImport[] = [
    {
      alias: "TypeGraphQL",
      moduleSpecifier: "type-graphql",
      kind: "namespace",
    },
  ];
  const dtsImports: DtsImport[] = [];
  const runtimeRefs = new Map<string, string>();

  addGraphQLScalarsImportIfNeeded(
    jsImports,
    fieldsToEmit.map(field => field.typeGraphQLType),
  );
  addCustomScalarsImportIfNeeded(
    jsImports,
    dtsImports,
    runtimeRefs,
    fieldsToEmit.map(field => field.typeGraphQLType),
    2,
  );

  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    fieldsToEmit
      .filter(field => field.selectedInputType.location === "inputObjectTypes")
      .map(field => field.selectedInputType.type)
      .filter(typeName => typeName !== inputType.typeName),
    typeName => createImportModuleSpecifier(inputsFolderName, typeName),
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    fieldsToEmit
      .filter(field => field.selectedInputType.location === "enumTypes")
      .map(field => field.selectedInputType.type),
    typeName => createImportModuleSpecifier(enumsFolderName, typeName, 2),
  );

  const classLines = [
    `let ${inputType.typeName} = class ${inputType.typeName} {`,
    ...mappedFields.flatMap(field => {
      const typeName = field.typeName;
      return [
        `  get ${typeName}() {`,
        `    return this.${field.name};`,
        "  }",
        `  set ${typeName}(${field.name}) {`,
        `    this.${field.name} = ${field.name};`,
        "  }",
      ];
    }),
    "};",
    `exports.${inputType.typeName} = ${inputType.typeName};`,
  ];

  const decoratorLines = [
    ...fieldsToEmit
      .filter(field => !field.hasMappedName)
      .flatMap(field =>
        renderPropertyDecorator({
          decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(field.typeGraphQLType, runtimeRefs)}, { nullable: ${String(
            !field.isRequired,
          )} })`,
          propertyName: field.name,
          runtimeType: toDesignTypeReference(
            field.selectedInputType,
            field.fieldTSType,
            runtimeRefs,
          ),
          targetName: inputType.typeName,
        }),
      ),
    ...mappedFields.flatMap(field =>
      renderPropertyDecorator({
        decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(field.typeGraphQLType, runtimeRefs)}, { nullable: ${String(
          !field.isRequired,
        )} })`,
        propertyName: field.typeName,
        runtimeType: toDesignTypeReference(
          field.selectedInputType,
          field.fieldTSType,
          runtimeRefs,
        ),
        targetName: inputType.typeName,
      }),
    ),
    `exports.${inputType.typeName} = ${inputType.typeName} = tslib_1.__decorate([`,
    `    TypeGraphQL.InputType(${JSON.stringify(inputType.typeName)}, ${options.emitIsAbstract ? "{ isAbstract: true }" : "{}"})`,
    `], ${inputType.typeName});`,
  ];

  const jsLines = [
    renderJsHeader([inputType.typeName]),
    ...renderJsImports(jsImports),
    ...classLines,
    ...decoratorLines,
  ];

  const dtsLines = [
    ...renderDtsImports(dtsImports),
    `export declare class ${inputType.typeName} {`,
    ...fieldsToEmit.map(
      field =>
        `    ${field.name}${field.isRequired ? ":" : "?:"} ${field.fieldTSType};`,
    ),
    ...mappedFields.flatMap(field => {
      const accessorType = normalizeAccessorType(
        field.fieldTSType,
        field.isRequired,
      );
      return [
        `    get ${field.typeName}(): ${accessorType};`,
        `    set ${field.typeName}(value: ${accessorType});`,
      ];
    }),
    "}",
  ];

  return {
    js: withTrailingNewline(jsLines.join("\n")),
    dts: withTrailingNewline(dtsLines.join("\n")),
  };
}

export function emitArgsModule(
  fields: readonly DMMF.SchemaArg[],
  argsTypeName: string,
  inputImportsLevel = 3,
): GeneratedModule {
  const jsImports: JSImport[] = [
    {
      alias: "TypeGraphQL",
      moduleSpecifier: "type-graphql",
      kind: "namespace",
    },
  ];
  const dtsImports: DtsImport[] = [];
  const runtimeRefs = new Map<string, string>();

  addGraphQLScalarsImportIfNeeded(
    jsImports,
    fields.map(field => field.typeGraphQLType),
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    fields
      .filter(arg => arg.selectedInputType.location === "inputObjectTypes")
      .map(arg => arg.selectedInputType.type),
    typeName =>
      createImportModuleSpecifier(
        inputsFolderName,
        typeName,
        inputImportsLevel,
      ),
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    fields
      .filter(arg => arg.selectedInputType.location === "enumTypes")
      .map(arg => arg.selectedInputType.type),
    typeName =>
      createImportModuleSpecifier(
        enumsFolderName,
        typeName,
        inputImportsLevel + 1,
      ),
  );

  const jsLines = [
    renderJsHeader([argsTypeName]),
    ...renderJsImports(jsImports),
    `let ${argsTypeName} = class ${argsTypeName} {};`,
    `exports.${argsTypeName} = ${argsTypeName};`,
    ...fields.flatMap(arg =>
      renderPropertyDecorator({
        decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(arg.typeGraphQLType, runtimeRefs)}, { nullable: ${String(
          !arg.isRequired,
        )} })`,
        propertyName: arg.typeName,
        runtimeType: toDesignTypeReference(
          arg.selectedInputType,
          arg.fieldTSType,
          runtimeRefs,
        ),
        targetName: argsTypeName,
      }),
    ),
    `exports.${argsTypeName} = ${argsTypeName} = tslib_1.__decorate([`,
    "    TypeGraphQL.ArgsType()",
    `], ${argsTypeName});`,
  ];

  const dtsLines = [
    ...renderDtsImports(dtsImports),
    `export declare class ${argsTypeName} {`,
    ...fields.map(
      arg =>
        `    ${arg.typeName}${arg.isRequired ? ":" : "?:"} ${arg.fieldTSType};`,
    ),
    "}",
  ];

  return {
    js: withTrailingNewline(jsLines.join("\n")),
    dts: withTrailingNewline(dtsLines.join("\n")),
  };
}

export function emitEnumModule(enumDef: DMMF.Enum): GeneratedModule {
  const description = cleanDocsString(enumDef.docs);
  const jsLines = [
    renderJsHeader([enumDef.typeName]),
    'const tslib_1 = require("tslib");',
    'const TypeGraphQL = tslib_1.__importStar(require("type-graphql"));',
    `var ${enumDef.typeName};`,
    `(function (${enumDef.typeName}) {`,
    ...enumDef.valuesMap.map(
      ({ name, value }) =>
        `    ${enumDef.typeName}[${JSON.stringify(name)}] = ${JSON.stringify(value)};`,
    ),
    `})(${enumDef.typeName} || (exports.${enumDef.typeName} = ${enumDef.typeName} = {}));`,
    `TypeGraphQL.registerEnumType(${enumDef.typeName}, {`,
    `    name: ${JSON.stringify(enumDef.typeName)},`,
    `    description: ${description ? JSON.stringify(description) : "undefined"},`,
    "});",
  ];

  const dtsLines = [
    `export declare enum ${enumDef.typeName} {`,
    ...enumDef.valuesMap.map(
      ({ name, value }) => `    ${name} = ${JSON.stringify(value)},`,
    ),
    "}",
  ];

  return {
    js: withTrailingNewline(jsLines.join("\n")),
    dts: withTrailingNewline(dtsLines.join("\n")),
  };
}

export function emitModelModule(
  model: DMMF.Model,
  modelOutputType: DMMF.OutputType,
  dmmfDocument: DmmfDocument,
): GeneratedModule {
  const jsImports: JSImport[] = [
    {
      alias: "TypeGraphQL",
      moduleSpecifier: "type-graphql",
      kind: "namespace",
    },
  ];
  const dtsImports: DtsImport[] = [];
  const runtimeRefs = new Map<string, string>();

  addGraphQLScalarsImportIfNeeded(
    jsImports,
    model.fields.map(field => field.typeGraphQLType),
  );
  addCustomScalarsImportIfNeeded(
    jsImports,
    dtsImports,
    runtimeRefs,
    model.fields.map(field => field.typeGraphQLType),
    1,
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    model.fields
      .filter(field => field.location === "outputObjectTypes")
      .filter(field => field.type !== model.name)
      .map(field =>
        dmmfDocument.isModelName(field.type)
          ? (dmmfDocument.getModelTypeName(field.type) ?? field.type)
          : field.type,
      ),
    typeName => createImportModuleSpecifier(modelsFolderName, typeName),
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    model.fields
      .filter(field => field.location === "enumTypes")
      .map(field => field.type),
    typeName => createImportModuleSpecifier(enumsFolderName, typeName),
  );

  const countField = dmmfDocument.getOutputTypeField(
    modelOutputType.name,
    "_count",
  );
  const shouldEmitCountField =
    countField !== undefined &&
    dmmfDocument.shouldGenerateBlock("crudResolvers");
  if (countField && shouldEmitCountField) {
    addNamedTypeImports(
      jsImports,
      dtsImports,
      runtimeRefs,
      [countField.typeGraphQLType],
      typeName =>
        createImportModuleSpecifier(
          `${resolversFolderName}/${outputsFolderName}`,
          typeName,
        ),
    );
  }

  const accessorFields = model.fields.filter(
    field =>
      field.typeFieldAlias && !field.relationName && !field.isOmitted.output,
  );
  const propertyFields = model.fields.map(field => ({
    field,
    isOptional:
      !!field.relationName ||
      field.isOmitted.output ||
      (!field.isRequired && field.typeFieldAlias === undefined),
  }));

  const classLines = [
    `class ${model.typeName} {`,
    ...accessorFields.flatMap(field => [
      `  get ${field.typeFieldAlias!}() {`,
      `    return ${field.isRequired ? `this.${field.name}` : `this.${field.name} ?? null`};`,
      "  }",
      `  set ${field.typeFieldAlias!}(${field.name}) {`,
      `    this.${field.name} = ${field.name};`,
      "  }",
    ]),
    "}",
    `exports.${model.typeName} = ${model.typeName};`,
  ];

  const decoratorLines = [
    ...propertyFields.flatMap(({ field, isOptional }) => {
      if (
        field.relationName ||
        field.typeFieldAlias ||
        field.isOmitted.output
      ) {
        return [];
      }
      const options = [`nullable: ${String(isOptional)}`];
      if (field.docs) {
        options.push(`description: ${JSON.stringify(field.docs)}`);
      }
      return renderPropertyDecorator({
        decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(field.typeGraphQLType, runtimeRefs)}, { ${options.join(", ")} })`,
        propertyName: field.name,
        runtimeType: toDesignTypeReference(
          field,
          field.fieldTSType,
          runtimeRefs,
        ),
        targetName: model.typeName,
      });
    }),
    ...accessorFields.flatMap(field => {
      const options = [`nullable: ${String(!field.isRequired)}`];
      if (field.docs) {
        options.push(`description: ${JSON.stringify(field.docs)}`);
      }
      return renderPropertyDecorator({
        decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(field.typeGraphQLType, runtimeRefs)}, { ${options.join(", ")} })`,
        propertyName: field.typeFieldAlias!,
        runtimeType: toDesignTypeReference(
          field,
          field.fieldTSType,
          runtimeRefs,
        ),
        targetName: model.typeName,
        isAccessor: true,
      });
    }),
    ...(countField && shouldEmitCountField
      ? renderPropertyDecorator({
          decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(countField.typeGraphQLType, runtimeRefs)}, { nullable: ${String(
            !countField.isRequired,
          )} })`,
          propertyName: countField.name,
          runtimeType: toDesignTypeReference(
            countField.outputType,
            countField.fieldTSType,
            runtimeRefs,
          ),
          targetName: model.typeName,
        })
      : []),
  ];

  const jsLines = [
    renderJsHeader([model.typeName]),
    ...renderJsImports(jsImports),
    ...classLines,
    ...decoratorLines,
    ...(!model.isOmitted.output
      ? [
          "tslib_1.__decorate([",
          `    TypeGraphQL.ObjectType(${JSON.stringify(model.typeName)}, ${renderObjectTypeOptions(model.docs, dmmfDocument.options.emitIsAbstract, dmmfDocument.options.simpleResolvers)})`,
          `], ${model.typeName});`,
        ]
      : []),
  ];

  const dtsLines = [
    ...renderDtsImports(dtsImports),
    `export declare class ${model.typeName} {`,
    ...propertyFields.map(
      ({ field, isOptional }) =>
        `    ${field.name}${isOptional ? "?:" : ":"} ${field.fieldTSType};`,
    ),
    ...(countField && shouldEmitCountField
      ? [
          `    ${countField.name}${countField.isRequired ? ":" : "?:"} ${countField.fieldTSType};`,
        ]
      : []),
    ...accessorFields.map(
      field =>
        `    get ${field.typeFieldAlias!}(): ${normalizeAccessorType(field.fieldTSType, field.isRequired)};`,
    ),
    "}",
  ];

  return {
    js: withTrailingNewline(jsLines.join("\n")),
    dts: withTrailingNewline(dtsLines.join("\n")),
  };
}

export function emitOutputTypeModule(
  type: DMMF.OutputType,
  dmmfDocument: DmmfDocument,
): GeneratedModule {
  const fieldArgsTypeNames = type.fields
    .filter(it => it.argsTypeName)
    .map(it => it.argsTypeName!);
  const outputObjectTypes = type.fields.filter(
    field => field.outputType.location === "outputObjectTypes",
  );
  const outputObjectModelTypes = outputObjectTypes.filter(field =>
    dmmfDocument.isModelTypeName(field.outputType.type),
  );

  const jsImports: JSImport[] = [
    {
      alias: "TypeGraphQL",
      moduleSpecifier: "type-graphql",
      kind: "namespace",
    },
  ];
  const dtsImports: DtsImport[] = [];
  const runtimeRefs = new Map<string, string>();

  addGraphQLScalarsImportIfNeeded(
    jsImports,
    type.fields.map(field => field.typeGraphQLType),
  );
  addCustomScalarsImportIfNeeded(
    jsImports,
    dtsImports,
    runtimeRefs,
    type.fields.map(field => field.typeGraphQLType),
    2,
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    fieldArgsTypeNames,
    typeName => createImportModuleSpecifier(argsFolderName, typeName, 0),
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    outputObjectTypes
      .filter(field => !outputObjectModelTypes.includes(field))
      .map(field => field.outputType.type),
    typeName => createImportModuleSpecifier(outputsFolderName, typeName),
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    outputObjectModelTypes.map(field => field.outputType.type),
    typeName => createImportModuleSpecifier(modelsFolderName, typeName, 2),
  );
  addNamedTypeImports(
    jsImports,
    dtsImports,
    runtimeRefs,
    type.fields
      .map(field => field.outputType)
      .filter(fieldType => fieldType.location === "enumTypes")
      .map(fieldType => fieldType.type),
    typeName => createImportModuleSpecifier(enumsFolderName, typeName, 2),
  );

  const propertyFields = type.fields.filter(field => !field.argsTypeName);
  const methodFields = type.fields.filter(field => field.argsTypeName);

  const classLines = [
    `let ${type.typeName} = class ${type.typeName} {`,
    ...methodFields.flatMap(field => [
      `  ${`get${pascalCase(field.name)}`}(root, args) {`,
      `    return root.${field.name};`,
      "  }",
    ]),
    "};",
    `exports.${type.typeName} = ${type.typeName};`,
  ];

  const decoratorLines = [
    ...propertyFields.flatMap(field =>
      renderPropertyDecorator({
        decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(field.typeGraphQLType, runtimeRefs)}, { nullable: ${String(
          !field.isRequired,
        )} })`,
        propertyName: field.name,
        runtimeType: toDesignTypeReference(
          field.outputType,
          field.fieldTSType,
          runtimeRefs,
        ),
        targetName: type.typeName,
      }),
    ),
    ...methodFields.flatMap(field =>
      renderMethodDecorator({
        decorator: `TypeGraphQL.Field(_type => ${toRuntimeTypeGraphQLReference(field.typeGraphQLType, runtimeRefs)}, { name: ${JSON.stringify(
          field.name,
        )}, nullable: ${String(!field.isRequired)} })`,
        paramDecorators: [
          "TypeGraphQL.Root()",
          `TypeGraphQL.Args(_type => ${runtimeRefs.get(field.argsTypeName!) ?? field.argsTypeName!})`,
        ],
        paramTypes: [type.typeName, field.argsTypeName!].map(
          typeName => runtimeRefs.get(typeName) ?? typeName,
        ),
        propertyName: `get${pascalCase(field.name)}`,
        returnType: toDesignTypeReference(
          field.outputType,
          field.fieldTSType,
          runtimeRefs,
        ),
        targetName: type.typeName,
      }),
    ),
    `exports.${type.typeName} = ${type.typeName} = tslib_1.__decorate([`,
    `    TypeGraphQL.ObjectType(${JSON.stringify(type.typeName)}, ${renderOutputTypeOptions(dmmfDocument.options.emitIsAbstract, dmmfDocument.options.simpleResolvers)})`,
    `], ${type.typeName});`,
  ];

  const jsLines = [
    renderJsHeader([type.typeName]),
    ...renderJsImports(jsImports),
    ...classLines,
    ...decoratorLines,
  ];

  const dtsLines = [
    ...renderDtsImports(dtsImports),
    `export declare class ${type.typeName} {`,
    ...propertyFields.map(
      field =>
        `    ${field.name}${field.isRequired ? ":" : "?:"} ${field.fieldTSType};`,
    ),
    ...methodFields.map(
      field =>
        `    get${pascalCase(field.name)}(root: ${type.typeName}, args: ${field.argsTypeName!}): ${field.fieldTSType};`,
    ),
    "}",
  ];

  return {
    js: withTrailingNewline(jsLines.join("\n")),
    dts: withTrailingNewline(dtsLines.join("\n")),
  };
}

export function renderResolverModule(options: {
  className: string;
  modelTypeName: string;
  modelRuntimeRef?: string;
  jsImports: JSImport[];
  dtsImports: DtsImport[];
  methods: Array<{
    name: string;
    parameterNames: string[];
    jsBody: string[];
    dtsSignature: string;
    decorator: string;
    paramDecorators: string[];
    paramTypes: string[];
  }>;
}): GeneratedModule {
  const jsLines = [
    renderJsHeader([options.className]),
    ...renderJsImports(options.jsImports),
    `let ${options.className} = class ${options.className} {`,
    ...options.methods.flatMap(method => [
      `  ${method.name}(${method.parameterNames.join(", ")}) {`,
      ...method.jsBody.map(line => `    ${line}`),
      "  }",
    ]),
    "};",
    `exports.${options.className} = ${options.className};`,
    ...options.methods.flatMap(method =>
      renderMethodDecorator({
        decorator: method.decorator,
        paramDecorators: method.paramDecorators,
        paramTypes: method.paramTypes,
        propertyName: method.name,
        returnType: "Promise",
        targetName: options.className,
      }),
    ),
    `exports.${options.className} = ${options.className} = tslib_1.__decorate([`,
    `    TypeGraphQL.Resolver(_of => ${options.modelRuntimeRef ?? options.modelTypeName})`,
    `], ${options.className});`,
  ];

  const dtsLines = [
    ...renderDtsImports(options.dtsImports),
    `export declare class ${options.className} {`,
    ...options.methods.map(method => `    ${method.dtsSignature}`),
    "}",
  ];

  return {
    js: withTrailingNewline(jsLines.join("\n")),
    dts: withTrailingNewline(dtsLines.join("\n")),
  };
}

export function buildCrudResolverMethod(args: {
  action: DMMF.Action;
  mapping: DMMF.ModelMapping;
  generatorOptions: GeneratorOptions;
  runtimeRefs: Map<string, string>;
}): {
  name: string;
  parameterNames: string[];
  jsBody: string[];
  dtsSignature: string;
  decorator: string;
  paramDecorators: string[];
  paramTypes: string[];
} {
  const parameters = [
    "ctx",
    "info",
    ...(args.action.argsTypeName ? ["args"] : []),
  ];
  const paramDecorators = [
    "TypeGraphQL.Ctx()",
    "TypeGraphQL.Info()",
    ...(!args.action.argsTypeName
      ? []
      : [
          `TypeGraphQL.Args(_type => ${args.runtimeRefs.get(args.action.argsTypeName) ?? args.action.argsTypeName})`,
        ]),
  ];
  const paramTypes = [
    "Object",
    "Object",
    ...(!args.action.argsTypeName
      ? []
      : [
          args.runtimeRefs.get(args.action.argsTypeName) ??
            args.action.argsTypeName,
        ]),
  ];

  return {
    name: args.action.name,
    parameterNames: parameters,
    decorator: `TypeGraphQL.${args.action.operation}(_returns => ${toRuntimeTypeGraphQLReference(args.action.typeGraphQLType, args.runtimeRefs)}, { nullable: ${String(
      !args.action.method.isRequired,
    )} })`,
    paramDecorators,
    paramTypes,
    dtsSignature: `${args.action.name}(${parameters
      .map((parameterName, index) => {
        const type =
          parameterName === "ctx"
            ? "any"
            : parameterName === "info"
              ? "GraphQLResolveInfo"
              : args.action.argsTypeName!;
        return `${parameterName}: ${type}`;
      })
      .join(", ")}): Promise<${args.action.returnTSType}>;`,
    jsBody: renderCrudMethodBody(args.action, args.mapping),
  };
}

export function buildRelationResolverMethod(args: {
  field: DMMF.RelationField;
  modelTypeName: string;
  rootArgName: string;
  whereCondition: string;
  generatorOptions: GeneratorOptions;
  runtimeRefs: Map<string, string>;
}): {
  name: string;
  parameterNames: string[];
  jsBody: string[];
  dtsSignature: string;
  decorator: string;
  paramDecorators: string[];
  paramTypes: string[];
} {
  const methodName = args.field.typeFieldAlias ?? args.field.name;
  const parameterNames = [
    args.rootArgName,
    "ctx",
    "info",
    ...(args.field.argsTypeName ? ["args"] : []),
  ];

  return {
    name: methodName,
    parameterNames,
    decorator: `TypeGraphQL.FieldResolver(_type => ${toRuntimeTypeGraphQLReference(args.field.typeGraphQLType, args.runtimeRefs)}, { ${[
      `nullable: ${String(!args.field.isRequired)}`,
      ...(args.field.docs
        ? [`description: ${JSON.stringify(args.field.docs)}`]
        : []),
    ].join(", ")} })`,
    paramDecorators: [
      "TypeGraphQL.Root()",
      "TypeGraphQL.Ctx()",
      "TypeGraphQL.Info()",
      ...(!args.field.argsTypeName
        ? []
        : [
            `TypeGraphQL.Args(_type => ${args.runtimeRefs.get(args.field.argsTypeName) ?? args.field.argsTypeName})`,
          ]),
    ],
    paramTypes: [
      args.runtimeRefs.get(args.modelTypeName) ?? args.modelTypeName,
      "Object",
      "Object",
      ...(!args.field.argsTypeName
        ? []
        : [
            args.runtimeRefs.get(args.field.argsTypeName) ??
              args.field.argsTypeName,
          ]),
    ],
    dtsSignature: `${methodName}(${parameterNames
      .map((parameterName, index) => {
        const type =
          index === 0
            ? args.modelTypeName
            : parameterName === "ctx"
              ? "any"
              : parameterName === "info"
                ? "GraphQLResolveInfo"
                : args.field.argsTypeName!;
        return `${parameterName}: ${type}`;
      })
      .join(", ")}): Promise<${args.field.fieldTSType}>;`,
    jsBody: [
      "const { _count } = helpers_1.transformInfoIntoPrismaArgs(info);",
      `return helpers_1.getPrismaFromContext(ctx).${uncapitalize(args.modelTypeName)}.findUniqueOrThrow({`,
      "  where: {",
      ...indentLines(args.whereCondition.trim().split("\n"), 2),
      "  },",
      `}).${args.field.name}({${args.field.argsTypeName ? "\n  ...args," : ""}`,
      "  ...(_count && helpers_1.transformCountFieldIntoSelectRelationsCount(_count)),",
      "});",
    ],
  };
}

export function renderNamedImportModule(
  moduleSpecifier: string,
  names: string[],
): GeneratedModule {
  return createBarrelModule(
    unique(names)
      .sort()
      .map(name => `${moduleSpecifier}/${name}`),
  );
}

function renderCrudMethodBody(
  action: DMMF.Action,
  mapping: DMMF.ModelMapping,
): string[] {
  if (action.kind === DMMF.ModelAction.aggregate) {
    return [
      `return helpers_1.getPrismaFromContext(ctx).${mapping.collectionName}.${action.prismaMethod}({`,
      "  ...args,",
      "  ...helpers_1.transformInfoIntoPrismaArgs(info),",
      "});",
    ];
  }

  if (action.kind === DMMF.ModelAction.groupBy) {
    return [
      "const { _count, _avg, _sum, _min, _max } = helpers_1.transformInfoIntoPrismaArgs(info);",
      `return helpers_1.getPrismaFromContext(ctx).${mapping.collectionName}.${action.prismaMethod}({`,
      "  ...args,",
      "  ...Object.fromEntries(",
      "    Object.entries({ _count, _avg, _sum, _min, _max }).filter(([_, value]) => value != null),",
      "  ),",
      "});",
    ];
  }

  return [
    "const { _count } = helpers_1.transformInfoIntoPrismaArgs(info);",
    `return helpers_1.getPrismaFromContext(ctx).${mapping.collectionName}.${action.prismaMethod}({`,
    "  ...args,",
    "  ...(_count && helpers_1.transformCountFieldIntoSelectRelationsCount(_count)),",
    "});",
  ];
}

function renderJsHeader(exportNames: string[] = []): string {
  const sortedNames = [...exportNames].sort();
  return [
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    ...(sortedNames.length > 0
      ? [`exports.${sortedNames.join(" = exports.")} = void 0;`]
      : []),
  ].join("\n");
}

function renderJsImports(imports: JSImport[]): string[] {
  const lines = ['const tslib_1 = require("tslib");'];
  const seen = new Set<string>(["tslib:tslib_1"]);

  for (const importDef of imports) {
    const key = `${importDef.kind}:${importDef.alias}:${importDef.moduleSpecifier}:${importDef.names?.join(",") ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (importDef.kind === "namespace") {
      lines.push(
        `const ${importDef.alias} = tslib_1.__importStar(require(${JSON.stringify(importDef.moduleSpecifier)}));`,
      );
      continue;
    }

    if (importDef.kind === "default") {
      lines.push(
        `const ${importDef.alias} = tslib_1.__importDefault(require(${JSON.stringify(importDef.moduleSpecifier)}));`,
      );
      continue;
    }

    lines.push(
      `const ${importDef.alias} = require(${JSON.stringify(importDef.moduleSpecifier)});`,
    );
  }

  return lines;
}

function renderDtsImports(imports: DtsImport[]): string[] {
  const deduped = new Map<string, DtsImport>();
  for (const importDef of imports) {
    const key = `${importDef.moduleSpecifier}:${importDef.namespace ?? ""}:${importDef.named?.join(",") ?? ""}:${importDef.isTypeOnly ? "type" : "value"}`;
    deduped.set(key, importDef);
  }

  return [...deduped.values()].map(importDef => {
    if (importDef.namespace) {
      return `import ${importDef.isTypeOnly ? "type " : ""}* as ${importDef.namespace} from ${JSON.stringify(importDef.moduleSpecifier)};`;
    }
    return `import ${importDef.isTypeOnly ? "type " : ""}{ ${unique(
      importDef.named ?? [],
    )
      .sort()
      .join(", ")} } from ${JSON.stringify(importDef.moduleSpecifier)};`;
  });
}

function addGraphQLScalarsImportIfNeeded(
  jsImports: JSImport[],
  graphQLTypes: string[],
): void {
  if (graphQLTypes.some(typeName => typeName.includes("GraphQLScalars."))) {
    jsImports.push({
      alias: "GraphQLScalars",
      moduleSpecifier: "graphql-scalars",
      kind: "namespace",
    });
  }
}

function addCustomScalarsImportIfNeeded(
  jsImports: JSImport[],
  dtsImports: DtsImport[],
  runtimeRefs: Map<string, string>,
  graphQLTypes: string[],
  level: number,
): void {
  const scalarNames = [
    ...(graphQLTypes.some(typeName => typeName.includes("DecimalJSScalar"))
      ? ["DecimalJSScalar"]
      : []),
    ...(graphQLTypes.some(typeName => typeName.includes("BytesScalar"))
      ? ["BytesScalar"]
      : []),
  ];

  if (scalarNames.length === 0) {
    return;
  }

  const moduleSpecifier =
    (level === 0 ? "./" : "") +
    path.posix.join(...Array(level).fill(".."), "scalars");

  jsImports.push({
    alias: "scalars_1",
    moduleSpecifier,
    kind: "named",
    names: scalarNames,
  });
  dtsImports.push({
    moduleSpecifier,
    named: scalarNames,
  });
  for (const name of scalarNames) {
    runtimeRefs.set(name, `scalars_1.${name}`);
  }
}

function addNamedTypeImports(
  jsImports: JSImport[],
  dtsImports: DtsImport[],
  runtimeRefs: Map<string, string>,
  typeNames: string[],
  moduleSpecifierFactory: (typeName: string) => string,
): void {
  for (const typeName of unique(typeNames).sort()) {
    const alias = `${sanitizeAlias(typeName)}_1`;
    jsImports.push({
      alias,
      moduleSpecifier: moduleSpecifierFactory(typeName),
      kind: "named",
      names: [typeName],
    });
    dtsImports.push({
      moduleSpecifier: moduleSpecifierFactory(typeName),
      named: [typeName],
    });
    runtimeRefs.set(typeName, `${alias}.${typeName}`);
  }
}

function toRuntimeTypeGraphQLReference(
  typeGraphQLType: string,
  runtimeRefs: Map<string, string>,
): string {
  if (typeGraphQLType.startsWith("[") && typeGraphQLType.endsWith("]")) {
    return `[${toRuntimeTypeGraphQLReference(typeGraphQLType.slice(1, -1), runtimeRefs)}]`;
  }

  if (typeGraphQLType.includes(".")) {
    return typeGraphQLType;
  }

  return runtimeRefs.get(typeGraphQLType) ?? typeGraphQLType;
}

function toDesignTypeReference(
  typeInfo: DMMF.SchemaArgInputType | DMMF.TypeInfo | DMMF.ModelField,
  fieldTSType: string,
  runtimeRefs: Map<string, string>,
): string {
  if (typeInfo.isList) {
    return "Array";
  }

  if (typeInfo.location === "scalar") {
    switch (typeInfo.type) {
      case "String":
        return "String";
      case "Boolean":
        return "Boolean";
      case "Int":
      case "Float":
        return "Number";
      case "DateTime":
        return "Date";
      case "BigInt":
        return "BigInt";
      case "Json":
      case "Decimal":
      case "Bytes":
        return "Object";
      default:
        return "Object";
    }
  }

  if (typeInfo.location === "enumTypes") {
    return "String";
  }

  if (fieldTSType.includes("|")) {
    return "String";
  }

  return runtimeRefs.get(typeInfo.type) ?? typeInfo.type;
}

function renderPropertyDecorator(spec: PropertyDecoratorSpec): string[] {
  const descriptorArg = spec.isAccessor ? "null" : "void 0";
  return [
    "tslib_1.__decorate([",
    `    ${spec.decorator},`,
    `    tslib_1.__metadata("design:type", ${spec.runtimeType})`,
    `], ${spec.targetName}.prototype, ${JSON.stringify(spec.propertyName)}, ${descriptorArg});`,
  ];
}

function renderMethodDecorator(spec: MethodDecoratorSpec): string[] {
  return [
    "tslib_1.__decorate([",
    `    ${spec.decorator},`,
    ...(spec.paramDecorators ?? []).map(
      (decorator, index) => `    tslib_1.__param(${index}, ${decorator}),`,
    ),
    '    tslib_1.__metadata("design:type", Function),',
    `    tslib_1.__metadata("design:paramtypes", [${(spec.paramTypes ?? []).join(", ")}]),`,
    `    tslib_1.__metadata("design:returntype", ${spec.returnType ?? "void 0"})`,
    `], ${spec.targetName}.prototype, ${JSON.stringify(spec.propertyName)}, null);`,
  ];
}

function renderObjectTypeOptions(
  docs: string | undefined,
  emitIsAbstract: boolean | undefined,
  simpleResolvers: boolean | undefined,
): string {
  const options = [
    ...(emitIsAbstract ? ["isAbstract: true"] : []),
    ...(docs ? [`description: ${JSON.stringify(docs)}`] : []),
    ...(simpleResolvers ? ["simpleResolvers: true"] : []),
  ];
  return options.length > 0 ? `{ ${options.join(", ")} }` : "{}";
}

function renderOutputTypeOptions(
  emitIsAbstract: boolean | undefined,
  simpleResolvers: boolean | undefined,
): string {
  const options = [
    ...(emitIsAbstract ? ["isAbstract: true"] : []),
    ...(simpleResolvers ? ["simpleResolvers: true"] : []),
  ];
  return options.length > 0 ? `{ ${options.join(", ")} }` : "{}";
}

function sanitizeAlias(value: string): string {
  return value.replace(/[^A-Za-z0-9_$]/g, "_");
}

function normalizeAccessorType(typeName: string, isRequired: boolean): string {
  if (isRequired) {
    return typeName;
  }
  return typeName.endsWith(" | undefined")
    ? typeName
    : typeName.endsWith(" | null")
      ? typeName
      : `${typeName} | undefined`;
}

function indentLines(lines: string[], level: number): string[] {
  return lines.map(line => `${"  ".repeat(level)}${line}`);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uncapitalize(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
