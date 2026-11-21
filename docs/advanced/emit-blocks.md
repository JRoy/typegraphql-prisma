---
title: Emit only selected blocks
sidebar_label: Emit selected blocks
---

If you don't want to have generated all the CRUD API with all resolvers, arguments, inputs, outputs, models, etc., you can provide an `emitOnly` generator option, which accepts an array of values: `enums`, `models`, `crudResolvers`, `relationResolvers`, `inputs` or `outputs`, e.g.:

```prisma {3}
generator typegraphql {
  provider = "typegraphql-prisma"
  emitOnly = ["models", "inputs"]
}
```

This way the generator will emit only the parts that you're interested in, like models and inputs but without outputs or resolvers.

:::note
Be aware that e.g. `models` requires `enums` in order to compile.
So sometimes you will receive more generated items than only those listed in `emitOnly`, especially when it comes to `crudResolvers` that requires almost all the pieces being generated.
:::

## Emit only reachable inputs

Set `emitOnlyReachableInputs = true` to emit only input classes referenced by
generated resolver arguments and model/output field arguments (including `_count`),
plus their transitive input-field dependencies. This option defaults to `false`;
enum generation is unchanged. It does not enable blocks excluded by `emitOnly`.

Inputs used by your application rather than generated resolvers must be listed in
`additionalInputTypes`, including inputs used only as TypeScript types:

```prisma
generator typegraphql {
  provider                = "typegraphql-prisma"
  emitOnly                = "models,inputs,relationResolvers"
  emitOnlyReachableInputs = true
  additionalInputTypes    = "UserCreateInput,StringFieldUpdateOperationsInput"
}
```

`additionalInputTypes` is a comma-separated list of generated input class names.
When reachable-input emission is enabled, unknown names fail generation. Its
default is empty. Input barrels, enhancement maps and bundled indexes include
only the retained inputs; deep imports of pruned classes are no longer available.
