import {
  PropertyDeclarationStructure,
  OptionalKind,
  Project,
  GetAccessorDeclarationStructure,
  SetAccessorDeclarationStructure,
  Writers,
  MethodDeclarationStructure,
} from "ts-morph";
import path from "path";

import { outputsFolderName, inputsFolderName } from "./config";
import {
  generateTypeGraphQLImport,
  generateInputsImports,
  generateEnumsImports,
  generateArgsImports,
  generateGraphQLScalarsImport,
  generatePrismaNamespaceImport,
  generateOutputsImports,
  generateCustomScalarsImport,
  generateModelsImports,
} from "./imports";
import { DmmfDocument } from "./dmmf/dmmf-document";
import { DMMF } from "./dmmf/types";
import { GeneratorOptions } from "./options";
import { pascalCase } from "./helpers";

export function generateOutputTypeClassFromType(
  project: Project,
  dirPath: string,
  type: DMMF.OutputType,
  dmmfDocument: DmmfDocument,
) {
  const fileDirPath = path.resolve(dirPath, outputsFolderName);
  const filePath = path.resolve(fileDirPath, `${type.typeName}.ts`);
  const sourceFile = project.createSourceFile(filePath, undefined, {
    overwrite: true,
  });

  const fieldArgsTypeNames = type.fields
    .filter(it => it.argsTypeName)
    .map(it => it.argsTypeName!);
  const outputObjectTypes = type.fields.filter(
    field => field.outputType.location === "outputObjectTypes",
  );
  const outputObjectModelTypes = outputObjectTypes.filter(field =>
    dmmfDocument.isModelTypeName(field.outputType.type),
  );

  generateTypeGraphQLImport(sourceFile);
  generateGraphQLScalarsImport(sourceFile);
  generatePrismaNamespaceImport(sourceFile, dmmfDocument.options, 2);
  generateCustomScalarsImport(
    sourceFile,
    type.fields.some(field => field.outputType.type === "Bytes"),
    2,
  );
  generateArgsImports(sourceFile, fieldArgsTypeNames, 0);
  generateOutputsImports(
    sourceFile,
    outputObjectTypes
      .filter(field => !outputObjectModelTypes.includes(field))
      .map(field => field.outputType.type),
    1,
  );
  generateModelsImports(
    sourceFile,
    outputObjectModelTypes.map(field => field.outputType.type),
    2,
  );
  generateEnumsImports(
    sourceFile,
    type.fields
      .map(field => field.outputType)
      .filter(fieldType => fieldType.location === "enumTypes")
      .map(fieldType => fieldType.type),
    2,
  );

  sourceFile.addClass({
    name: type.typeName,
    isExported: true,
    decorators: [
      {
        name: "TypeGraphQL.ObjectType",
        arguments: [
          `"${type.typeName}"`,
          (() => {
            const options = [];
            if (dmmfDocument.options.emitIsAbstract)
              options.push("isAbstract: true");
            if (dmmfDocument.options.simpleResolvers)
              options.push("simpleResolvers: true");
            return options.length > 0 ? `{ ${options.join(", ")} }` : "{}";
          })(),
        ],
      },
    ],
    properties: [
      ...type.fields
        .filter(field => !field.argsTypeName)
        .map<OptionalKind<PropertyDeclarationStructure>>(field => ({
          name: field.name,
          type: field.fieldTSType,
          hasExclamationToken: true,
          hasQuestionToken: false,
          trailingTrivia: "\r\n",
          decorators: [
            {
              name: "TypeGraphQL.Field",
              arguments: [
                `_type => ${field.typeGraphQLType}`,
                `{ nullable: ${!field.isRequired} }`,
              ],
            },
          ],
        })),
      ...type.fields
        .filter(field => field.argsTypeName)
        .map<OptionalKind<PropertyDeclarationStructure>>(field => ({
          name: field.name,
          type: field.fieldTSType,
          hasExclamationToken: true,
          hasQuestionToken: false,
        })),
    ],
    methods: type.fields
      .filter(field => field.argsTypeName)
      .map<OptionalKind<MethodDeclarationStructure>>(field => ({
        name: `get${pascalCase(field.name)}`,
        returnType: field.fieldTSType,
        trailingTrivia: "\r\n",
        decorators: [
          {
            name: "TypeGraphQL.Field",
            arguments: [
              `_type => ${field.typeGraphQLType}`,
              `{ name: "${field.name}", nullable: ${!field.isRequired} }`,
            ],
          },
        ],
        parameters: [
          {
            name: "root",
            type: type.typeName,
            decorators: [{ name: "TypeGraphQL.Root", arguments: [] }],
          },
          {
            name: "args",
            type: field.argsTypeName,
            decorators: [{ name: "TypeGraphQL.Args", arguments: [] }],
          },
        ],
        statements: [Writers.returnStatement(`root.${field.name}`)],
      })),
  });
}

export function generateInputTypeClassFromType(
  project: Project,
  dirPath: string,
  inputType: DMMF.InputType,
  options: GeneratorOptions,
) {
  const filePath = path.resolve(
    dirPath,
    inputsFolderName,
    `${inputType.typeName}.ts`,
  );
  const sourceFile = project.createSourceFile(filePath, undefined, {
    overwrite: true,
  });

  generateTypeGraphQLImport(sourceFile);
  generateGraphQLScalarsImport(sourceFile);
  generatePrismaNamespaceImport(sourceFile, options, 2);
  generateCustomScalarsImport(
    sourceFile,
    inputType.fields.some(field => field.selectedInputType.type === "Bytes"),
    2,
  );
  generateInputsImports(
    sourceFile,
    inputType.fields
      .filter(field => field.selectedInputType.location === "inputObjectTypes")
      .map(field => field.selectedInputType.type)
      .filter(fieldType => fieldType !== inputType.typeName),
  );
  generateEnumsImports(
    sourceFile,
    inputType.fields
      .map(field => field.selectedInputType)
      .filter(fieldType => fieldType.location === "enumTypes")
      .map(fieldType => fieldType.type as string),
    2,
  );

  const fieldsToEmit = inputType.fields.filter(field => !field.isOmitted);
  const mappedFields = fieldsToEmit.filter(field => field.hasMappedName);

  sourceFile.addClass({
    name: inputType.typeName,
    isExported: true,
    decorators: [
      {
        name: "TypeGraphQL.InputType",
        arguments: [
          `"${inputType.typeName}"`,
          options.emitIsAbstract ? "{ isAbstract: true }" : "{}",
        ],
      },
    ],
    properties: fieldsToEmit.map<OptionalKind<PropertyDeclarationStructure>>(
      field => {
        return {
          name: field.name,
          type: field.fieldTSType,
          hasExclamationToken: !!field.isRequired,
          hasQuestionToken: !field.isRequired,
          trailingTrivia: "\r\n",
          decorators: field.hasMappedName
            ? []
            : [
                {
                  name: "TypeGraphQL.Field",
                  arguments: [
                    `_type => ${field.typeGraphQLType}`,
                    `{ nullable: ${!field.isRequired} }`,
                  ],
                },
              ],
        };
      },
    ),
    getAccessors: mappedFields.map<
      OptionalKind<GetAccessorDeclarationStructure>
    >(field => {
      return {
        name: field.typeName,
        type: field.fieldTSType,
        hasExclamationToken: field.isRequired,
        hasQuestionToken: !field.isRequired,
        trailingTrivia: "\r\n",
        statements: [`return this.${field.name};`],
        decorators: [
          {
            name: "TypeGraphQL.Field",
            arguments: [
              `_type => ${field.typeGraphQLType}`,
              `{ nullable: ${!field.isRequired} }`,
            ],
          },
        ],
      };
    }),
    setAccessors: mappedFields.map<
      OptionalKind<SetAccessorDeclarationStructure>
    >(field => {
      return {
        name: field.typeName,
        type: field.fieldTSType,
        hasExclamationToken: field.isRequired,
        hasQuestionToken: !field.isRequired,
        trailingTrivia: "\r\n",
        parameters: [{ name: field.name, type: field.fieldTSType }],
        statements: [`this.${field.name} = ${field.name};`],
      };
    }),
  });
}

export function generateInputTypeText(
  inputType: DMMF.InputType,
  options: GeneratorOptions,
): string {
  const lines: string[] = [];

  lines.push(`import * as TypeGraphQL from "type-graphql";`);
  lines.push(`import * as GraphQLScalars from "graphql-scalars";`);

  const prismaImportPath =
    options.customPrismaImportPath ??
    path.posix.join(options.relativePrismaOutputPath, "client");
  const prismaModuleSpecifier =
    options.absolutePrismaOutputPath ??
    path.posix.join("..", "..", prismaImportPath);
  lines.push(`import { Prisma } from "${prismaModuleSpecifier}";`);

  const hasBytes = inputType.fields.some(
    field => field.selectedInputType.type === "Bytes",
  );
  const scalarsPath = path.posix.join("..", "..", "scalars");
  if (hasBytes) {
    lines.push(
      `import { DecimalJSScalar, BytesScalar } from "${scalarsPath}";`,
    );
  } else {
    lines.push(`import { DecimalJSScalar } from "${scalarsPath}";`);
  }

  const inputTypeImports = [
    ...new Set(
      inputType.fields
        .filter(
          field => field.selectedInputType.location === "inputObjectTypes",
        )
        .map(field => field.selectedInputType.type)
        .filter(fieldType => fieldType !== inputType.typeName),
    ),
  ].sort();
  for (const importName of inputTypeImports) {
    const importPath = path.posix.join("..", "inputs", importName);
    lines.push(`import { ${importName} } from "${importPath}";`);
  }

  const enumImports = [
    ...new Set(
      inputType.fields
        .map(field => field.selectedInputType)
        .filter(fieldType => fieldType.location === "enumTypes")
        .map(fieldType => fieldType.type as string),
    ),
  ].sort();
  for (const enumName of enumImports) {
    const importPath = path.posix.join("..", "..", "enums", enumName);
    lines.push(`import { ${enumName} } from "${importPath}";`);
  }

  lines.push("");

  const decoratorOptions = options.emitIsAbstract
    ? "{ isAbstract: true }"
    : "{}";
  lines.push(
    `@TypeGraphQL.InputType("${inputType.typeName}", ${decoratorOptions})`,
  );
  lines.push(`export class ${inputType.typeName} {`);

  const fieldsToEmit = inputType.fields.filter(field => !field.isOmitted);
  const mappedFields = fieldsToEmit.filter(field => field.hasMappedName);

  for (let i = 0; i < fieldsToEmit.length; i++) {
    const field = fieldsToEmit[i];
    const isLast = i === fieldsToEmit.length - 1 && mappedFields.length === 0;

    if (field.hasMappedName) {
      if (field.isRequired) {
        lines.push(`    ${field.name}!: ${field.fieldTSType};`);
      } else {
        lines.push(`    ${field.name}?: ${field.fieldTSType};`);
      }
    } else {
      lines.push(
        `    @TypeGraphQL.Field(_type => ${field.typeGraphQLType}, { nullable: ${!field.isRequired} })`,
      );
      if (field.isRequired) {
        lines.push(`    ${field.name}!: ${field.fieldTSType};`);
      } else {
        lines.push(`    ${field.name}?: ${field.fieldTSType};`);
      }
    }

    if (!isLast) {
      lines.push("");
    }
  }

  for (let i = 0; i < mappedFields.length; i++) {
    const field = mappedFields[i];
    const isLastMapped = i === mappedFields.length - 1;

    lines.push(
      `    @TypeGraphQL.Field(_type => ${field.typeGraphQLType}, { nullable: ${!field.isRequired} })`,
    );
    lines.push(`    get ${field.typeName}() {`);
    lines.push(`        return this.${field.name};`);
    lines.push(`    }`);

    lines.push("");

    lines.push(
      `    set ${field.typeName}(${field.name}: ${field.fieldTSType}) {`,
    );
    lines.push(`        this.${field.name} = ${field.name};`);
    lines.push(`    }`);

    if (!isLastMapped) {
      lines.push("");
    }
  }

  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}
