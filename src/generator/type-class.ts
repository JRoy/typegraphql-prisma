import path from "node:path";

import { inputsFolderName, outputsFolderName } from "./config";
import type { DmmfDocument } from "./dmmf/dmmf-document";
import type { DMMF } from "./dmmf/types";
import type { GeneratorOptions } from "./options";
import {
  createGeneratedFiles,
  emitInputTypeModule,
  emitOutputTypeModule,
  type GeneratedFile,
} from "./string-emitter";

export function generateOutputTypeClassFromType(
  dirPath: string,
  type: DMMF.OutputType,
  dmmfDocument: DmmfDocument,
): GeneratedFile[] {
  const fileDirPath = path.resolve(dirPath, outputsFolderName);
  const filePath = path.resolve(fileDirPath, type.typeName);
  return createGeneratedFiles(
    filePath,
    emitOutputTypeModule(type, dmmfDocument),
  );
}

export function generateInputTypeClassFromType(
  dirPath: string,
  inputType: DMMF.InputType,
  options: GeneratorOptions,
): GeneratedFile[] {
  const filePath = path.resolve(dirPath, inputsFolderName, inputType.typeName);
  return createGeneratedFiles(
    filePath,
    emitInputTypeModule(inputType, options),
  );
}
