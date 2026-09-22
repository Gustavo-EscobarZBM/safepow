import { Product } from '../modules/products/product.entity';
import {
  adminQuery,
  closeTestConnections,
  seedCompany,
  seedProduct,
  truncateAll,
  withTenant,
} from '../test-utils/test-db';

describe('semântica de updatedAt (F5 do desenho mestre)', () => {
  beforeEach(() => truncateAll());
  afterAll(() => closeTestConnections());

  it('updatedAt é o INÍCIO da transação, não o momento da gravação', async () => {
    const companyId = await seedCompany('Empresa F5');
    const productId = await seedProduct({ companyId, barcode: '7890000000011', name: 'Arroz' });
    // Lido como ::text para manter os MICROssegundos do timestamptz (DEFAULT now()). Lido como Date
    // (o padrão do driver pg), o valor seria truncado a milissegundos e o `>` de `atualizado` mais
    // abaixo daria true mesmo que a gravação nunca tivesse tocado em updatedAt.
    const [{ antes }] = await adminQuery(`SELECT "updatedAt"::text AS antes FROM products WHERE id = $1`, [productId]);

    const inicioDaTransacao: string = await withTenant({ companyId }, async (manager) => {
      await manager.query('SELECT pg_sleep(1.1)'); // a transação já começou; a gravação vem depois
      // now() é constante dentro da transação: é o instante em que ela COMEÇOU. Epoch em texto (e não
      // timestamp::text) para não depender do fuso da sessão (role da app vs. admin) e manter os µs.
      const [linhaInicio] = await manager.query(`SELECT EXTRACT(EPOCH FROM now())::text AS "inicioDaTransacao"`);
      const product = await manager.findOneOrFail(Product, { where: { id: productId } });
      product.name = 'Arroz Integral';
      await manager.save(product);
      return linhaInicio.inicioDaTransacao;
    });

    const [linha] = await adminQuery(
      `SELECT "updatedAt" > $2::timestamptz AS atualizado,
              EXTRACT(EPOCH FROM "updatedAt")::text AS "updatedAtEpoch",
              EXTRACT(EPOCH FROM (clock_timestamp() - "updatedAt"))::float AS "idadeEmSegundos"
         FROM products WHERE id = $1`,
      [productId, antes],
    );

    expect(linha.atualizado).toBe(true); // a gravação de fato alterou updatedAt
    // updatedAt é EXATAMENTE o now() da transação (µs incluídos), não o instante do UPDATE.
    expect(linha.updatedAtEpoch).toBe(inicioDaTransacao);
    // Se updatedAt fosse o instante do UPDATE, a idade seria ~0. Sendo o início da
    // transação (1,1 s antes do commit), a idade é >= 1,1 s.
    expect(linha.idadeEmSegundos).toBeGreaterThanOrEqual(1.0);
  });
});
