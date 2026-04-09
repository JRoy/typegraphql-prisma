import path from "node:path";
import { performance } from "node:perf_hooks";

import { enumsFolderName } from "../config";
import generateEnumFromDef from "../enum";
import { generateEnumsBarrelFile } from "../imports";
import { createGeneratedFiles } from "../string-emitter";
import {
  BaseBlockGenerator,
  type GenerationResult,
} from "./base-block-generator";

export class EnumBlockGenerator extends BaseBlockGenerator {
  protected shouldGenerate(): boolean {
    return this.dmmfDocument.shouldGenerateBlock("enums");
  }

  public getBlockName(): string {
    return "enums";
  }

  public generate(): GenerationResult {
    if (!this.shouldGenerate()) {
      return { files: [], itemsGenerated: 0 };
    }

    const startTime = performance.now();

    const allEnums = this.dmmfDocument.datamodel.enums.concat(
      this.dmmfDocument.schema.enums.filter(
        enumDef =>
          !this.dmmfDocument.datamodel.enums
            .map(e => e.typeName)
            .includes(enumDef.typeName),
      ),
    );

    const files = allEnums.flatMap(enumDef =>
      generateEnumFromDef(this.baseDirPath, enumDef),
    );

    const emittedEnumNames = Array.from(
      new Set(
        this.dmmfDocument.schema.enums
          .map(it => it.typeName)
          .concat(this.dmmfDocument.datamodel.enums.map(it => it.typeName)),
      ),
    );

    files.push(
      ...createGeneratedFiles(
        path.resolve(this.baseDirPath, enumsFolderName, "index"),
        generateEnumsBarrelFile(emittedEnumNames),
      ),
    );

    return {
      files,
      itemsGenerated: allEnums.length,
      timeElapsed: performance.now() - startTime,
    };
  }
}
