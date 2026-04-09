import type { DmmfDocument } from "./dmmf/dmmf-document";
import type { GeneratedModule } from "./string-emitter";

export function generateCustomScalars(
  dmmfDocument: DmmfDocument,
): GeneratedModule {
  const hasBytes = dmmfDocument.scalarTypeNames.includes("Bytes");
  const prismaModuleSpecifier =
    dmmfDocument.options.absolutePrismaOutputPath ??
    `./${dmmfDocument.options.relativePrismaOutputPath}/client`;

  const jsLines = [
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    `exports.DecimalJSScalar${hasBytes ? " = exports.BytesScalar" : ""} = void 0;`,
    'const graphql_1 = require("graphql");',
    `const client_1 = require(${JSON.stringify(prismaModuleSpecifier)});`,
    "exports.DecimalJSScalar = new graphql_1.GraphQLScalarType({",
    '    name: "Decimal",',
    '    description: "GraphQL Scalar representing the Prisma.Decimal type, based on Decimal.js library.",',
    "    serialize: value => {",
    "        if (!(client_1.Prisma.Decimal.isDecimal(value))) {",
    "            throw new Error(`[DecimalError] Invalid argument: ${Object.prototype.toString.call(value)}. Expected Prisma.Decimal.`);",
    "        }",
    "        return value.toString();",
    "    },",
    "    parseValue: value => {",
    '        if (!(typeof value === "string")) {',
    "            throw new Error(`[DecimalError] Invalid argument: ${typeof value}. Expected string.`);",
    "        }",
    "        return new client_1.Prisma.Decimal(value);",
    "    },",
    "});",
    ...(hasBytes
      ? [
          "function uint8ArrayToBase64(uint8Array) {",
          '    return Buffer.from(uint8Array).toString("base64");',
          "}",
          "function base64ToUint8Array(base64) {",
          '    return new Uint8Array(Buffer.from(base64, "base64"));',
          "}",
          "exports.BytesScalar = new graphql_1.GraphQLScalarType({",
          '    name: "Bytes",',
          '    description: "GraphQL Scalar representing the Prisma.Bytes type.",',
          "    serialize: value => {",
          "        if (!(value instanceof Uint8Array)) {",
          "            throw new Error(`[BytesError] Invalid argument: ${Object.prototype.toString.call(value)}. Expected Uint8Array.`);",
          "        }",
          "        return uint8ArrayToBase64(value);",
          "    },",
          "    parseValue: value => {",
          '        if (!(typeof value === "string")) {',
          "            throw new Error(`[BytesError] Invalid argument: ${typeof value}. Expected string.`);",
          "        }",
          "        return base64ToUint8Array(value);",
          "    },",
          "    parseLiteral: ast => {",
          "        if (ast.kind !== graphql_1.Kind.STRING) {",
          "            throw new Error(`[BytesError] Invalid argument: ${ast.kind}. Expected string.`);",
          "        }",
          "        return base64ToUint8Array(ast.value);",
          "    },",
          "});",
        ]
      : []),
  ];

  const dtsLines = [
    'import { GraphQLScalarType } from "graphql";',
    "export declare const DecimalJSScalar: GraphQLScalarType;",
    ...(hasBytes
      ? ["export declare const BytesScalar: GraphQLScalarType;"]
      : []),
  ];

  return {
    js: `${jsLines.join("\n")}\n`,
    dts: `${dtsLines.join("\n")}\n`,
  };
}
