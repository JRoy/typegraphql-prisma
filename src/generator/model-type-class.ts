import path from "node:path";

import { modelsFolderName } from "./config";
import type { DMMF } from "./dmmf/types";
import type { DmmfDocument } from "./dmmf/dmmf-document";
import {
  createGeneratedFiles,
  emitModelModule,
  type GeneratedFile,
} from "./string-emitter";

export default function generateObjectTypeClassFromModel(
  baseDirPath: string,
  model: DMMF.Model,
  modelOutputType: DMMF.OutputType,
  dmmfDocument: DmmfDocument,
): GeneratedFile[] {
  const dirPath = path.resolve(baseDirPath, modelsFolderName);
  const filePath = path.resolve(dirPath, model.typeName);
  return createGeneratedFiles(
    filePath,
    emitModelModule(model, modelOutputType, dmmfDocument),
  );
}
