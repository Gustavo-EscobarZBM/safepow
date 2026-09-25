import { readFileSync } from 'fs';
import { join } from 'path';
import { dataSourceOptions } from './data-source';
import { ENTITIES } from './entities';

describe('módulo único de entidades (ENTITIES)', () => {
  it('tem exatamente as 11 entidades registradas hoje, sem duplicatas', () => {
    expect(ENTITIES).toHaveLength(11);
    expect(new Set(ENTITIES).size).toBe(11);
  });

  it('data-source.ts usa a MESMA referência de ENTITIES (não uma cópia)', () => {
    expect(dataSourceOptions.entities).toBe(ENTITIES);
  });

  it('app.module.ts importa ENTITIES de ./database/entities, sem lista duplicada', () => {
    const source = readFileSync(join(__dirname, '..', 'app.module.ts'), 'utf-8');
    expect(source).toContain("import { ENTITIES } from './database/entities';");
    expect(source).toContain('entities: ENTITIES,');
  });
});
