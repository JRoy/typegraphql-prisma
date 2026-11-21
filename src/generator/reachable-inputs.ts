import type { DmmfDocument } from "./dmmf/dmmf-document";
import type { DMMF } from "./dmmf/types";

export function getReachableInputTypes(
  document: DmmfDocument,
): DMMF.InputType[] {
  const inputs = document.schema.inputTypes;
  const byName = new Map(inputs.map(input => [input.typeName, input]));
  const roots = new Set(document.inputTypeRoots);
  for (const name of document.options.additionalInputTypes ?? []) {
    if (!byName.has(name)) {
      throw new Error(`Unknown additionalInputTypes input type: "${name}"`);
    }
    roots.add(name);
  }

  const reachable = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (reachable.has(name)) {
      continue;
    }
    const input = byName.get(name);
    if (!input) {
      throw new Error(`Unknown referenced input type: "${name}"`);
    }
    reachable.add(name);
    for (const field of input.fields) {
      if (
        !field.isOmitted &&
        field.selectedInputType.location === "inputObjectTypes"
      ) {
        pending.push(field.selectedInputType.type);
      }
    }
  }
  return inputs.filter(input => reachable.has(input.typeName));
}
