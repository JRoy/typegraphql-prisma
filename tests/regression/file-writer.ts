import fs from "node:fs/promises";
import path from "node:path";

import generateArtifactsDirPath from "../helpers/artifacts-dir";
import { writeGeneratedFiles } from "../../src/generator/file-writer";

describe("generated file writer", () => {
  let outputDirPath: string;

  beforeEach(() => {
    outputDirPath = generateArtifactsDirPath("file-writer");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([1, 4])(
    "creates each directory once and preserves UTF-8 bytes with concurrency %s",
    async concurrency => {
      const files = Array.from({ length: 12 }, (_, index) => ({
        filePath: path.join(
          outputDirPath,
          `nested/${index % 3}`,
          `${index}.js`,
        ),
        content: `exports.value = "é漢字 ${index}";\n`,
      }));
      const mkdir = jest.spyOn(fs, "mkdir");

      await writeGeneratedFiles(files, concurrency);

      expect(mkdir).toHaveBeenCalledTimes(3);
      for (const directory of new Set(
        files.map(file => path.dirname(file.filePath)),
      )) {
        expect(mkdir).toHaveBeenCalledWith(directory, { recursive: true });
      }
      for (const file of files) {
        expect(await fs.readFile(file.filePath)).toEqual(
          Buffer.from(file.content, "utf8"),
        );
      }
    },
  );

  it("keeps the last duplicate path and replaces existing file contents", async () => {
    const filePath = path.join(outputDirPath, "value.js");
    await fs.mkdir(outputDirPath, { recursive: true });
    await fs.writeFile(filePath, "old contents are longer");

    await writeGeneratedFiles([
      { filePath, content: "first" },
      { filePath, content: "last\n" },
    ]);

    expect(await fs.readFile(filePath, "utf8")).toBe("last\n");
  });

  it("does not create directories for empty output", async () => {
    const mkdir = jest.spyOn(fs, "mkdir");

    await writeGeneratedFiles([]);

    expect(mkdir).not.toHaveBeenCalled();
  });

  it("rejects when a parent directory is a file", async () => {
    await fs.mkdir(outputDirPath, { recursive: true });
    const parent = path.join(outputDirPath, "blocked");
    await fs.writeFile(parent, "not a directory");

    await expect(
      writeGeneratedFiles([
        { filePath: path.join(parent, "value.js"), content: "value" },
      ]),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(parent, "utf8")).toBe("not a directory");
  });

  it("rejects when a file destination is a directory", async () => {
    const filePath = path.join(outputDirPath, "blocked.js");
    await fs.mkdir(filePath, { recursive: true });

    await expect(
      writeGeneratedFiles([{ filePath, content: "value" }]),
    ).rejects.toMatchObject({
      code: "EISDIR",
    });
    expect((await fs.stat(filePath)).isDirectory()).toBe(true);
  });
});
