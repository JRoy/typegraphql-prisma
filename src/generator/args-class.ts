import path from "node:path";

import { argsFolderName } from "./config";
import type { DmmfDocument } from "./dmmf/dmmf-document";
import type { DMMF } from "./dmmf/types";
import {
  createGeneratedFiles,
  emitArgsModule,
  type GeneratedFile,
} from "./string-emitter";

export default function generateArgsTypeClassFromArgs(
  generateDirPath: string,
  fields: readonly DMMF.SchemaArg[],
  argsTypeName: string,
  dmmfDocument: DmmfDocument,
  inputImportsLevel = 3,
): GeneratedFile[] {
  if (dmmfDocument.options.emitOnlyReachableInputs) {
    for (const field of fields) {
      if (field.selectedInputType.location === "inputObjectTypes") {
        dmmfDocument.inputTypeRoots.add(field.selectedInputType.type);
      }
    }
  }
  const dirPath = path.resolve(generateDirPath, argsFolderName);
  const filePath = path.resolve(dirPath, argsTypeName);
  return createGeneratedFiles(
    filePath,
    emitArgsModule(fields, argsTypeName, inputImportsLevel),
  );
}
