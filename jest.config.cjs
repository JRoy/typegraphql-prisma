/** @type {import('jest').Config} */
const config = {
  verbose: false,
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: {
            syntax: "typescript",
            decorators: true,
          },
          transform: {
            decoratorMetadata: true,
          },
          target: "es2022",
        },
      },
    ],
  },
  testMatch: ["<rootDir>/tests/**/*.ts"],
  testPathIgnorePatterns: [
    "<rootDir>/tests/helpers",
    "<rootDir>/tests/artifacts",
    "<rootDir>/tests/.*integration.*",
  ],
  rootDir: "./",
  collectCoverage: false,
  coverageDirectory: "<rootDir>/coverage",
  collectCoverageFrom: ["<rootDir>/src/**/*.ts", "!<rootDir>/src/**/*.d.ts"],
  modulePathIgnorePatterns: [
    "<rootDir>/experiments",
    "<rootDir>/lib",
    "<rootDir>/package",
    "<rootDir>/tests/artifacts",
  ],
  testTimeout: 10000,
  snapshotFormat: {
    escapeString: true,
    printBasicPrototype: true,
  },
  prettierPath: require.resolve("prettier-2"),
};

module.exports = config;
