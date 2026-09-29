import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  EMPTY_PRODUCT_FORM,
  ProductFormFields,
  productFormFromProduct,
  productPayload,
  type ProductFormValues,
} from './product-form-fields';
import type { CatalogTaxonomies } from './use-catalog-taxonomies';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), postForm: vi.fn(), getBlob: vi.fn() },
}));

const TAXONOMIES: CatalogTaxonomies = {
  categories: [
    { id: 'c1', name: 'Mercearia', parentId: null, path: 'Mercearia', isActive: true },
    { id: 'c2', name: 'Sazonal', parentId: null, path: 'Sazonal', isActive: false },
  ],
  brands: [{ id: 'b1', name: 'Coca-Cola', isActive: true }],
  suppliers: [{ id: 's1', name: 'Distribuidora Sul', isActive: true }],
};

function Harness({ initial, onValues }: { initial: ProductFormValues; onValues?: (v: ProductFormValues) => void }) {
  const [values, setValues] = useState(initial);
  return (
    <ProductFormFields
      idPrefix="t"
      values={values}
      taxonomies={TAXONOMIES}
      onChange={(next) => {
        setValues(next);
        onValues?.(next);
      }}
    />
  );
}

describe('productPayload (SP4 4.1)', () => {
  it('converte números, envia null para vazio e só manda validade quando perecível', () => {
    expect(
      productPayload({
        ...EMPTY_PRODUCT_FORM,
        barcode: '789',
        name: 'Refri',
        unitPrice: '9.99',
        costPrice: '3.1234',
        categoryId: 'c1',
        unit: 'UN',
        isPerishable: false,
        shelfLifeDays: '30',
      }),
    ).toEqual({
      barcode: '789',
      name: 'Refri',
      unitPrice: 9.99,
      costPrice: 3.1234,
      categoryId: 'c1',
      brandId: null,
      supplierId: null,
      unit: 'UN',
      isPerishable: false,
      shelfLifeDays: null,
      imageUrl: null,
      notes: null,
    });
    expect(productPayload({ ...EMPTY_PRODUCT_FORM, isPerishable: true, shelfLifeDays: '7' }).shelfLifeDays).toBe(7);
  });

  it('productFormFromProduct preenche a partir do produto', () => {
    expect(
      productFormFromProduct({
        id: 'p',
        barcode: '1',
        sku: null,
        name: 'Queijo',
        unitPrice: '10.00',
        costPrice: '6.5000',
        isActive: true,
        categoryId: 'c2',
        unit: 'KG',
        isPerishable: true,
        shelfLifeDays: 15,
      }),
    ).toMatchObject({ costPrice: '6.5', categoryId: 'c2', unit: 'KG', isPerishable: true, shelfLifeDays: '15' });
  });
});

describe('ProductFormFields (SP4 4.1)', () => {
  it('categoria arquivada já ligada aparece com "(arquivada)"; as arquivadas não ligadas não aparecem', () => {
    render(<Harness initial={{ ...EMPTY_PRODUCT_FORM, categoryId: 'c2' }} />);
    const select = screen.getByLabelText('Categoria') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Sem categoria', 'Mercearia', 'Sazonal (arquivada)']);
  });

  it('categoria arquivada não ligada ao produto não aparece', () => {
    render(<Harness initial={EMPTY_PRODUCT_FORM} />);
    const select = screen.getByLabelText('Categoria') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Sem categoria', 'Mercearia']);
  });

  it('validade só aparece com "Perecível" marcado', async () => {
    const onValues = vi.fn();
    render(<Harness initial={EMPTY_PRODUCT_FORM} onValues={onValues} />);
    expect(screen.queryByLabelText('Validade (dias)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Perecível'));
    await userEvent.type(screen.getByLabelText('Validade (dias)'), '30');
    expect(onValues).toHaveBeenLastCalledWith(expect.objectContaining({ isPerishable: true, shelfLifeDays: '30' }));
  });

  it('custo aceita 4 casas (step 0.0001)', () => {
    render(<Harness initial={EMPTY_PRODUCT_FORM} />);
    expect(screen.getByLabelText('Preço de custo (R$)')).toHaveAttribute('step', '0.0001');
  });
});
