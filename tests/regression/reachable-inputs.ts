import { promises as fs } from "node:fs";
import path from "node:path";

import generateArtifactsDirPath from "../helpers/artifacts-dir";
import { generateCodeFromSchema } from "../helpers/generate-code";
import type { ExternalGeneratorOptions } from "../../src/generator/options";

const schema = `
  model User {
    id Int @id
    name String
    posts Post[]
  }
  model Post {
    id Int @id
    title String
    author User @relation(fields: [authorId], references: [id])
    authorId Int
  }
`;

async function readFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [name, content] of await readFiles(fullPath)) {
        files.set(path.join(entry.name, name), content);
      }
    } else {
      files.set(entry.name, await fs.readFile(fullPath, "utf8"));
    }
  }
  return files;
}

describe("reachable input emission", () => {
  async function generate(options: ExternalGeneratorOptions = {}) {
    const outputDirPath = generateArtifactsDirPath("reachable-inputs");
    await fs.mkdir(outputDirPath, { recursive: true });
    await generateCodeFromSchema(schema, {
      emitOnly: ["relationResolvers"],
      emitOnlyReachableInputs: true,
      ...options,
      outputDirPath,
    });
    return readFiles(outputDirPath);
  }

  function expectValidReferences(files: Map<string, string>) {
    for (const [name, content] of files) {
      for (const match of content.matchAll(
        /(?:from|require\()\s*["'](\.[^"']+)["'](?=\s*(?:\)|;|$))/g,
      )) {
        const target = path.normalize(path.join(path.dirname(name), match[1]));
        expect(
          files.has(`${target}.js`) || files.has(path.join(target, "index.js")),
        ).toBe(true);
      }
    }
  }

  it("prunes create/update inputs but retains recursive relation and count argument dependencies", async () => {
    const files = await generate();
    expect(files.has("resolvers/inputs/UserCreateInput.js")).toBe(false);
    expect(files.has("resolvers/inputs/PostWhereInput.js")).toBe(true);
    expect(files.has("resolvers/inputs/StringFilter.js")).toBe(true);
    expect(files.get("resolvers/outputs/args/UserCountPostsArgs.js")).toContain(
      "PostWhereInput",
    );
    expect(files.get("resolvers/inputs/index.js")).not.toContain(
      "UserCreateInput",
    );
    expect(files.get("enhance.d.ts")).not.toContain("UserCreateInput");
    expectValidReferences(files);
  });

  it.each([false, true])(
    "includes extra roots and their closure with omitInputsBarrel=%s",
    async omitInputsBarrel => {
      const files = await generate({
        additionalInputTypes: ["UserCreateInput"],
        omitInputsBarrel,
      });
      expect(files.has("resolvers/inputs/UserCreateInput.js")).toBe(true);
      expect(
        files.has("resolvers/inputs/PostCreateNestedManyWithoutAuthorInput.js"),
      ).toBe(true);
      expect(files.has("resolvers/inputs/index.js")).toBe(!omitInputsBarrel);
      expectValidReferences(files);
    },
  );

  it("fails clearly for an unknown extra root", async () => {
    await expect(
      generate({ additionalInputTypes: ["TypoInput"] }),
    ).rejects.toThrow('Unknown additionalInputTypes input type: "TypoInput"');
  });

  it("emits an empty inputs barrel when there are no argument or extra roots", async () => {
    const files = await generate({ emitOnly: ["inputs"] });
    expect(
      [...files.keys()].filter(name => name.startsWith("resolvers/inputs/")),
    ).toEqual(["resolvers/inputs/index.d.ts", "resolvers/inputs/index.js"]);
    expectValidReferences(files);
  });

  it("retains CRUD and separate action argument dependencies", async () => {
    const files = await generate({ emitOnly: ["crudResolvers"] });
    expect(files.has("resolvers/inputs/UserCreateInput.js")).toBe(true);
    expect(files.has("resolvers/inputs/UserUpdateInput.js")).toBe(true);
    expectValidReferences(files);
  });

  it("leaves every output byte unchanged when disabled", async () => {
    const baseline = await generate({ emitOnlyReachableInputs: undefined });
    const disabled = await generate({ emitOnlyReachableInputs: false });
    expect(disabled).toEqual(baseline);
    expect(disabled.has("resolvers/inputs/UserCreateInput.js")).toBe(true);
  });
});
