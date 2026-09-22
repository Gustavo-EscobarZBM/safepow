/**
 * Testes de integração contra Postgres real (RLS, triggers, migrations, middleware).
 * Rodam com `npm run test:int` — ver backend/README.md, seção "Testes".
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // "-spec" com hífen de propósito: o jest.config.js (unitário) só casa ".spec.ts",
  // então `npm test` continua rápido e sem Docker.
  testRegex: '.*\\.int-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  // Um único banco compartilhado: os arquivos rodam em sequência.
  maxWorkers: 1,
  testTimeout: 60000,
  globalSetup: '<rootDir>/test-utils/global-setup.ts',
};
