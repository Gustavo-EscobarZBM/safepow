import { productsImportHandler } from '../handlers/products.import-handler';
import { headerFingerprint, normalizeHeader, suggestMapping } from './mapping';

const fields = productsImportHandler.fields;

describe('normalizeHeader', () => {
  it.each<[string, string]>([
    ['  Cód. Barras ', 'codbarras'],
    ['Preço de Venda', 'precodevenda'],
    ['EAN-13', 'ean13'],
  ])('%p ⇒ %p', (header, expected) => expect(normalizeHeader(header)).toBe(expected));
});

describe('headerFingerprint', () => {
  it('ignora ordem, acento, caixa e espaços', () => {
    expect(headerFingerprint(['EAN', 'Descrição'])).toBe(headerFingerprint([' descricao ', 'ean']));
  });
  it('muda quando os cabeçalhos mudam', () => {
    expect(headerFingerprint(['EAN', 'Descrição'])).not.toBe(headerFingerprint(['EAN']));
  });
  it('é sha256 hex', () => {
    expect(headerFingerprint(['a'])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('suggestMapping', () => {
  it('reconhece os nomes comuns de ERP, devolvendo o cabeçalho original', () => {
    expect(suggestMapping(['Cód. Barras', 'Descrição', 'Preço de Venda', 'Custo', 'Referência'], fields)).toEqual({
      barcode: 'Cód. Barras',
      name: 'Descrição',
      unitPrice: 'Preço de Venda',
      costPrice: 'Custo',
      sku: 'Referência',
    });
  });
  it('EAN / Produto / Preço', () => {
    expect(suggestMapping(['EAN', 'Produto', 'Preço'], fields)).toEqual({ barcode: 'EAN', name: 'Produto', unitPrice: 'Preço' });
  });
  it('"Código" sozinho é SKU, não código de barras', () => {
    expect(suggestMapping(['Código', 'Nome'], fields)).toEqual({ sku: 'Código', name: 'Nome' });
  });
  it('um cabeçalho nunca serve a dois campos', () => {
    const mapping = suggestMapping(['Preço', 'Preço'], fields);
    expect(Object.values(mapping)).toEqual(['Preço']);
  });
  it('os cabeçalhos do modelo de importação mapeiam todos os campos', () => {
    expect(suggestMapping(['Código de barras', 'Nome', 'SKU', 'Preço de venda', 'Custo'], fields)).toEqual({
      barcode: 'Código de barras',
      name: 'Nome',
      sku: 'SKU',
      unitPrice: 'Preço de venda',
      costPrice: 'Custo',
    });
  });
});
