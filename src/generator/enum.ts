import path from "node:path";

import { enumsFolderName } from "./config";
import type { DMMF } from "./dmmf/types";
import {
  createGeneratedFiles,
  emitEnumModule,
  type GeneratedFile,
} from "./string-emitter";

export default function generateEnumFromDef(
  baseDirPath: string,
  enumDef: DMMF.Enum,
): GeneratedFile[] {
  const dirPath = path.resolve(baseDirPath, enumsFolderName);
  const filePath = path.resolve(dirPath, enumDef.typeName);
  return createGeneratedFiles(filePath, emitEnumModule(enumDef));
}
