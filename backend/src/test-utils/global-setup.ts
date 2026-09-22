import { getTestDbConfig } from './test-db-config';
import { createTestDatabase } from './test-db-lifecycle';

/** Recria o banco de testes uma vez por execução do `npm run test:int`. */
export default async function globalSetup(): Promise<void> {
  await createTestDatabase(getTestDbConfig());
}
