import "reflect-metadata";
import { promises as fs } from "fs";
import path from "path";
import util from "util";
import childProcess from "child_process";
import { buildSchema } from "type-graphql";
import { graphql } from "graphql";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

import generateArtifactsDirPath from "../helpers/artifacts-dir";
import { getDirectoryStructureString } from "../helpers/structure";

const exec = util.promisify(childProcess.exec);

// Helper function to filter out Prisma informational messages from stderr
function filterPrismaInfoMessages(stderr: string): string {
  return stderr
    .replace(/┌─.*?└─.*?┘\s*/gs, "") // Update notifications
    .replace(/Loaded Prisma config from.*\n?/g, "") // Config loading message
    .replace(/Prisma schema loaded from.*\n?/g, "") // Schema loading message
    .trim();
}

describe("generator integration", () => {
  let cwdDirPath: string;
  let schema: string;

  beforeEach(async () => {
    cwdDirPath = generateArtifactsDirPath("functional-integration");
    await fs.mkdir(cwdDirPath, { recursive: true });

    schema = /* prisma */ `
      datasource db {
        provider = "postgresql"
      }

      generator client {
        provider = "prisma-client-js"
        output   = "./generated/client"
      }

      generator typegraphql {
        provider = "node ../../../src/cli/dev.ts"
        output   = "./generated/type-graphql"
      }

      enum Color {
        RED
        GREEN
        BLUE
      }

      model User {
        id     Int      @id @default(autoincrement())
        name   String?
        posts  Post[]
      }

      model Post {
        uuid      String  @id @default(cuid())
        content   String
        author    User    @relation(fields: [authorId], references: [id])
        authorId  Int
        color     Color
      }
    `;
    await fs.writeFile(path.join(cwdDirPath, "schema.prisma"), schema);

    // Prisma 7 requires connection URL in prisma.config.ts for CLI commands
    const dbUrl = process.env.TEST_DATABASE_URL || "";
    const prismaConfig = `import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./schema.prisma",
  datasource: {
    url: "${dbUrl}",
  },
});
`;
    await fs.writeFile(path.join(cwdDirPath, "prisma.config.ts"), prismaConfig);
  });

  it("should generates TypeGraphQL classes files to output folder by running `prisma generate`", async () => {
    const prismaGenerateResult = await exec("npx prisma generate", {
      cwd: cwdDirPath,
    });
    // console.log(prismaGenerateResult);

    const directoryStructureString = getDirectoryStructureString(
      cwdDirPath + "/generated/type-graphql",
    );

    expect(filterPrismaInfoMessages(prismaGenerateResult.stderr)).toHaveLength(
      0,
    );
    expect(directoryStructureString).toMatchSnapshot("files structure");
  }, 60000);

  it("should be able to use generate TypeGraphQL classes files to generate GraphQL schema", async () => {
    const prismaGenerateResult = await exec("npx prisma generate", {
      cwd: cwdDirPath,
    });
    // console.log(prismaGenerateResult);
    const {
      UserCrudResolver,
      PostCrudResolver,
      UserRelationsResolver,
      PostRelationsResolver,
    } = require(cwdDirPath + "/generated/type-graphql");
    await buildSchema({
      resolvers: [
        UserCrudResolver,
        PostCrudResolver,
        UserRelationsResolver,
        PostRelationsResolver,
      ],
      validate: false,
      emitSchemaFile: cwdDirPath + "/schema.graphql",
    });
    const graphQLSchemaSDL = await fs.readFile(cwdDirPath + "/schema.graphql", {
      encoding: "utf8",
    });

    expect(filterPrismaInfoMessages(prismaGenerateResult.stderr)).toHaveLength(
      0,
    );
    expect(graphQLSchemaSDL).toMatchSnapshot("graphQLSchemaSDL");
  }, 60000);

  it("should be able to generate TypeGraphQL classes files without any type errors", async () => {
    const tsconfigContent = {
      compilerOptions: {
        target: "ES2021",
        module: "commonjs",
        lib: ["ES2021"],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        forceConsistentCasingInFileNames: true,
      },
    };
    const typegraphqlfolderPath = path.join(
      cwdDirPath,
      "generated",
      "type-graphql",
    );

    const prismaGenerateResult = await exec("npx prisma generate", {
      cwd: cwdDirPath,
    });
    // console.log(prismaGenerateResult);
    await fs.writeFile(
      path.join(typegraphqlfolderPath, "tsconfig.json"),
      JSON.stringify(tsconfigContent),
    );
    const tscResult = await exec("npx tsc --noEmit", {
      cwd: typegraphqlfolderPath,
    });

    expect(filterPrismaInfoMessages(prismaGenerateResult.stderr)).toHaveLength(
      0,
    );
    expect(tscResult.stdout).toHaveLength(0);
    expect(tscResult.stderr).toHaveLength(0);
  }, 60000);

  it("should properly fetch the data from DB using PrismaClient while queried by GraphQL schema", async () => {
    const prismaGenerateResult = await exec("npx prisma generate", {
      cwd: cwdDirPath,
    });
    // console.log(prismaGenerateResult);
    expect(filterPrismaInfoMessages(prismaGenerateResult.stderr)).toHaveLength(
      0,
    );

    // Push schema to database (will create/update schema)
    const prismaPushResult = await exec(
      "npx prisma db push --accept-data-loss",
      { cwd: cwdDirPath },
    );
    // console.log(prismaPushResult);
    expect(filterPrismaInfoMessages(prismaPushResult.stderr)).toHaveLength(0);

    const { PrismaClient } = require(cwdDirPath + "/generated/client");
    const pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    // Clean up any existing test data
    await prisma.post.deleteMany({});
    await prisma.user.deleteMany({});

    await prisma.user.create({ data: { name: "test1" } });
    await prisma.user.create({
      data: {
        name: "test2",
        posts: {
          create: [
            {
              color: "RED",
              content: "post content",
            },
          ],
        },
      },
    });
    await prisma.user.create({ data: { name: "not test" } });

    const {
      UserCrudResolver,
      PostCrudResolver,
      UserRelationsResolver,
      PostRelationsResolver,
    } = require(cwdDirPath + "/generated/type-graphql");
    const graphQLSchema = await buildSchema({
      resolvers: [
        UserCrudResolver,
        PostCrudResolver,
        UserRelationsResolver,
        PostRelationsResolver,
      ],
      validate: false,
    });

    const query = /* graphql */ `
      query {
        users(where: {
          name: {
            startsWith: "test"
          }
        }) {
          id
          name
          posts {
            content
            color
            author {
              name
            }
          }
        }
      }
    `;
    const { data, errors } = await graphql({
      schema: graphQLSchema,
      source: query,
      contextValue: { prisma },
    });
    await prisma.$disconnect();
    await pool.end();

    expect(errors).toBeUndefined();
    expect(data).toMatchSnapshot("graphql data");
  }, 100000);
});
