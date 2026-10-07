import "reflect-metadata";
import { promises as fs } from "fs";
import { buildSchema, MiddlewareFn, Query, Resolver } from "type-graphql";
import { graphql, GraphQLSchema } from "graphql";

import generateArtifactsDirPath from "../helpers/artifacts-dir";
import { generateCodeFromSchema } from "../helpers/generate-code";

type Row = Record<string, any>;

const users: Row[] = [
  { id: 1, name: "Ada" },
  { id: 2, name: "Grace" },
  { id: 3, name: "Linus" },
];
const posts: Row[] = [
  { uuid: "p1", content: "one", authorId: 1, editorId: 2 },
  { uuid: "p2", content: "two", authorId: 2, editorId: null },
  { uuid: "p3", content: "three", authorId: 1, editorId: 2 },
];
const profiles: Row[] = [{ id: 10, bio: "Ada's bio", userId: 1 }];

// A tiny `findMany` that understands the filters the batcher emits:
// `{ field: { in } }`, `{ AND: [...] }`, plain equality and `startsWith`.
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") {
      return (condition as Row[]).every(it => matches(row, it));
    }
    if (condition && typeof condition === "object") {
      if ("in" in condition) {
        return condition.in.includes(row[key]);
      }
      if ("startsWith" in condition) {
        return String(row[key]).startsWith(condition.startsWith);
      }
      if ("equals" in condition) {
        return row[key] === condition.equals;
      }
    }
    return row[key] === condition;
  });
}

function createFindMany(table: Row[]) {
  return jest.fn(async (args: Row) => {
    const rows = table.filter(row => matches(row, args.where));
    if (args.orderBy) {
      const [[field, direction]] = Object.entries(
        Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy,
      );
      rows.sort(
        (a, b) =>
          (a[field] > b[field] ? 1 : -1) * (direction === "desc" ? -1 : 1),
      );
    }
    return rows;
  });
}

function createPrismaMock() {
  return {
    user: {
      findMany: createFindMany(users),
      findUniqueOrThrow: jest.fn(),
    },
    post: {
      findMany: createFindMany(posts),
      findUniqueOrThrow: jest.fn(),
    },
    profile: {
      findMany: createFindMany(profiles),
      findUniqueOrThrow: jest.fn(),
    },
  };
}

describe("batched relation resolvers", () => {
  let graphQLSchema: GraphQLSchema;
  let rootPosts: Row[];

  beforeAll(async () => {
    const outputDirPath = generateArtifactsDirPath("functional-batched");
    await fs.mkdir(outputDirPath, { recursive: true });
    const prismaSchema = /* prisma */ `
      model User {
        id          Int      @id @default(autoincrement())
        name        String?
        posts       Post[]
        editedPosts Post[]   @relation("editor")
        profile     Profile?
      }

      model Post {
        uuid      String  @id @default(cuid())
        content   String
        author    User    @relation(fields: [authorId], references: [id])
        authorId  Int
        editor    User?   @relation("editor", fields: [editorId], references: [id])
        editorId  Int?
      }

      model Profile {
        id      Int    @id @default(autoincrement())
        bio     String
        user    User   @relation(fields: [userId], references: [id])
        userId  Int    @unique
      }
    `;
    await generateCodeFromSchema(prismaSchema, {
      outputDirPath,
      batchRelationResolvers: true,
    });
    const {
      UserRelationsResolver,
      PostRelationsResolver,
      ProfileRelationsResolver,
      User,
      Post,
    } = require(outputDirPath);

    @Resolver()
    class CustomResolver {
      @Query(_returns => [User])
      users(): Row[] {
        return users;
      }

      @Query(_returns => [Post])
      posts(): Row[] {
        return rootPosts;
      }
    }

    const AsyncMiddleware: MiddlewareFn = async (_data, next) => {
      await Promise.resolve();
      return next();
    };

    graphQLSchema = await buildSchema({
      resolvers: [
        CustomResolver,
        UserRelationsResolver,
        PostRelationsResolver,
        ProfileRelationsResolver,
      ],
      globalMiddlewares: [AsyncMiddleware],
      validate: false,
    });
  });

  beforeEach(() => {
    rootPosts = posts;
  });

  async function execute(source: string, contextValue: object) {
    const result = await graphql({
      schema: graphQLSchema,
      source,
      contextValue,
    });
    expect(result.errors).toBeUndefined();
    return result.data as any;
  }

  it("batches to-one relations held on the root into one deduplicated query", async () => {
    const prisma = createPrismaMock();
    const data = await execute(`query { posts { uuid author { name } } }`, {
      prisma,
    });

    expect(data.posts.map((post: Row) => post.author.name)).toEqual([
      "Ada",
      "Grace",
      "Ada",
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
    });
    expect(prisma.post.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("resolves a null foreign key to null without querying", async () => {
    const prisma = createPrismaMock();
    const data = await execute(`query { posts { uuid editor { name } } }`, {
      prisma,
    });

    expect(data.posts.map((post: Row) => post.editor?.name ?? null)).toEqual([
      "Grace",
      null,
      "Grace",
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [2] } },
    });
  });

  it("keeps separate batches for different relations on the same model", async () => {
    const prisma = createPrismaMock();
    await execute(`query { posts { author { name } editor { name } } }`, {
      prisma,
    });

    // `author` and `editor` share the key field and args, so one batch.
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
    });
  });

  it("batches list back-relations and groups rows per root", async () => {
    const prisma = createPrismaMock();
    const data = await execute(`query { users { name posts { uuid } } }`, {
      prisma,
    });

    expect(
      data.users.map((user: Row) => user.posts.map((post: Row) => post.uuid)),
    ).toEqual([["p1", "p3"], ["p2"], []]);
    expect(prisma.post.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.post.findMany).toHaveBeenCalledWith({
      where: { authorId: { in: [1, 2, 3] } },
    });
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("merges list where and orderBy args into the batched query", async () => {
    const prisma = createPrismaMock();
    const data = await execute(
      `query {
        users {
          posts(
            where: { content: { startsWith: "t" } }
            orderBy: { content: desc }
          ) { uuid }
        }
      }`,
      { prisma },
    );

    expect(
      data.users.map((user: Row) => user.posts.map((post: Row) => post.uuid)),
    ).toEqual([["p3"], ["p2"], []]);
    expect(prisma.post.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.post.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ content: "desc" }],
      where: {
        AND: [
          { content: { startsWith: "t" } },
          { authorId: { in: [1, 2, 3] } },
        ],
      },
    });
  });

  it("falls back to the fluent API for paginated list args", async () => {
    const prisma = createPrismaMock();
    const fluentPosts = jest.fn().mockResolvedValue([]);
    prisma.user.findUniqueOrThrow.mockReturnValue({ posts: fluentPosts });

    await execute(`query { users { posts(take: 1) { uuid } } }`, { prisma });

    expect(prisma.post.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledTimes(3);
    expect(fluentPosts).toHaveBeenCalledWith({ take: 1 });
  });

  it("batches 1-1 back-relations keyed by the related unique column", async () => {
    const prisma = createPrismaMock();
    const data = await execute(`query { users { name profile { bio } } }`, {
      prisma,
    });

    expect(data.users.map((user: Row) => user.profile?.bio ?? null)).toEqual([
      "Ada's bio",
      null,
      null,
    ]);
    expect(prisma.profile.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.profile.findMany).toHaveBeenCalledWith({
      where: { userId: { in: [1, 2, 3] } },
    });
  });

  it("falls back to the fluent API when the root lacks the key field", async () => {
    rootPosts = [{ uuid: "p1", content: "one" }];
    const prisma = createPrismaMock();
    const fluentAuthor = jest.fn().mockResolvedValue(users[0]);
    prisma.post.findUniqueOrThrow.mockReturnValue({ author: fluentAuthor });

    const data = await execute(`query { posts { author { name } } }`, {
      prisma,
    });

    expect(data.posts[0].author.name).toBe("Ada");
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.post.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { uuid: "p1" },
    });
  });

  it("never shares batches or results across contexts or ticks", async () => {
    const prisma = createPrismaMock();
    const context = { prisma };
    await execute(`query { posts { author { name } } }`, context);
    await execute(`query { posts { author { name } } }`, context);
    await execute(`query { posts { author { name } } }`, { prisma });

    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
  });

  it("rejects every field in a batch when the query fails", async () => {
    const prisma = createPrismaMock();
    prisma.user.findMany.mockRejectedValueOnce(new Error("db down"));

    const result = await graphql({
      schema: graphQLSchema,
      source: `query { posts { uuid editor { name } } }`,
      contextValue: { prisma },
    });

    expect(result.errors?.map(error => error.message)).toEqual([
      "db down",
      "db down",
    ]);
  });
});
