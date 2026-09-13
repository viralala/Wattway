/**
 * WattWay · Team Kothimbir 🌿
 * Jest configuration — unit tests for the custom data structures run without a
 * database; integration tests spin up an in-memory MongoDB (see tests/helpers).
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/datastructures/**/*.ts',
    'src/algorithms/**/*.ts',
    'src/controllers/**/*.ts',
    'src/services/**/*.ts',
  ],
  testTimeout: 30000,
  clearMocks: true,
  verbose: true,
};
