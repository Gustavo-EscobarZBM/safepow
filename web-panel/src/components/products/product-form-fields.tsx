'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SELECT_CLASS } from '@/components/resources/resource-form-dialog';
import { PRODUCT_UNIT_LABELS, PRODUCT_UNITS, type Product, type ProductUnit } from '@/lib/types';
import { ProductImageInput } from './product-image-input';
import type { CatalogTaxonomies } from './use-catalog-taxonomies';

export interface ProductFormValues {
  barcode: string;
  name: string;
  unitPrice: string;
  costPrice: string;
  categoryId: string;
  brandId: string;
  supplierId: string;
  unit: ProductUnit;
  isPerishable: boolean;
  shelfLifeDays: string;
  imageUrl: string;
  notes: string;
}

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  barcode: '',
  name: '',
  unitPrice: '',
  costPrice: '',
  categoryId: '',
  brandId: '',
  supplierId: '',
  unit: 'UN',
  isPerishable: false,
  shelfLifeDays: '',
  imageUrl: '',
  notes: '',
};

const trimNumber = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : String(Number(value)));

export function productFormFromProduct(product: Product): ProductFormValues {
  return {
    barcode: product.barcode,
    name: product.name,
    unitPrice: String(product.unitPrice ?? ''),
    costPrice: trimNumber(product.costPrice),
    categoryId: product.categoryId ?? '',
    brandId: product.brandId ?? '',
    supplierId: product.supplierId ?? '',
    unit: product.unit ?? 'UN',
    isPerishable: product.isPerishable ?? false,
    shelfLifeDays: product.shelfLifeDays ? String(product.shelfLifeDays) : '',
    imageUrl: product.imageUrl ?? '',
    notes: product.notes ?? '',
  };
}

/** Corpo do POST/PATCH de produto: preço vazio não mexe (undefined); campos de catálogo vazios limpam (null). */
export function productPayload(values: ProductFormValues) {
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    barcode: values.barcode,
    name: values.name,
    unitPrice: values.unitPrice ? Number(values.unitPrice) : undefined,
    costPrice: values.costPrice ? Number(values.costPrice) : undefined,
    categoryId: orNull(values.categoryId),
    brandId: orNull(values.brandId),
    supplierId: orNull(values.supplierId),
    unit: values.unit,
    isPerishable: values.isPerishable,
    shelfLifeDays: values.isPerishable && values.shelfLifeDays ? Number(values.shelfLifeDays) : null,
    imageUrl: orNull(values.imageUrl),
    notes: orNull(values.notes),
  };
}

/** Ativos + o que o produto já usa (mesmo arquivado, rotulado) — arquivado não pode ser escolhido de novo. */
function taxonomyOptions(items: { id: string; isActive: boolean }[], selected: string, label: (item: never) => string, archived: string) {
  return items
    .filter((item) => item.isActive || item.id === selected)
    .map((item) => ({ value: item.id, label: label(item as never) + (item.isActive ? '' : ` (${archived})`) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

interface ProductFormFieldsProps {
  /** Prefixo dos ids dos campos (a tela tem o formulário de cadastro e o de edição ao mesmo tempo). */
  idPrefix: string;
  values: ProductFormValues;
  taxonomies: CatalogTaxonomies;
  onChange: (values: ProductFormValues) => void;
  /** Chamado ao mudar o código de barras (o cadastro usa para descartar a oferta de reativar). */
  onBarcodeChange?: () => void;
}

/** Campos do produto (SP4 4.1), comuns ao cadastro e à edição. */
export function ProductFormFields({ idPrefix, values, taxonomies, onChange, onBarcodeChange }: ProductFormFieldsProps) {
  const id = (field: string) => `${idPrefix}-${field}`;
  const set = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => onChange({ ...values, [field]: value });

  const selects = [
    {
      field: 'categoryId' as const,
      label: 'Categoria',
      empty: 'Sem categoria',
      options: taxonomyOptions(taxonomies.categories, values.categoryId, (c: { path: string }) => c.path, 'arquivada'),
    },
    {
      field: 'brandId' as const,
      label: 'Marca',
      empty: 'Sem marca',
      options: taxonomyOptions(taxonomies.brands, values.brandId, (b: { name: string }) => b.name, 'arquivada'),
    },
    {
      field: 'supplierId' as const,
      label: 'Fornecedor',
      empty: 'Sem fornecedor',
      options: taxonomyOptions(taxonomies.suppliers, values.supplierId, (s: { name: string }) => s.name, 'arquivado'),
    },
  ];

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={id('barcode')}>Código de barras</Label>
        <Input
          id={id('barcode')}
          required
          value={values.barcode}
          onChange={(e) => {
            set('barcode', e.target.value);
            onBarcodeChange?.();
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('name')}>Nome</Label>
        <Input id={id('name')} required value={values.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('unitPrice')}>Preço unitário (R$)</Label>
        <Input
          id={id('unitPrice')}
          type="number"
          step="0.01"
          min="0"
          value={values.unitPrice}
          onChange={(e) => set('unitPrice', e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('costPrice')}>Preço de custo (R$)</Label>
        <Input
          id={id('costPrice')}
          type="number"
          step="0.0001"
          min="0"
          value={values.costPrice}
          onChange={(e) => set('costPrice', e.target.value)}
        />
      </div>
      {selects.map((select) => (
        <div key={select.field} className="space-y-1.5">
          <Label htmlFor={id(select.field)}>{select.label}</Label>
          <select
            id={id(select.field)}
            className={SELECT_CLASS}
            value={values[select.field]}
            onChange={(e) => set(select.field, e.target.value)}
          >
            <option value="">{select.empty}</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="space-y-1.5">
        <Label htmlFor={id('unit')}>Unidade</Label>
        <select
          id={id('unit')}
          className={SELECT_CLASS}
          value={values.unit}
          onChange={(e) => set('unit', e.target.value as ProductUnit)}
        >
          {PRODUCT_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {PRODUCT_UNIT_LABELS[unit]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-4">
        <label htmlFor={id('isPerishable')} className="flex h-9 items-center gap-2 text-sm">
          <input
            id={id('isPerishable')}
            type="checkbox"
            checked={values.isPerishable}
            onChange={(e) => onChange({ ...values, isPerishable: e.target.checked, shelfLifeDays: e.target.checked ? values.shelfLifeDays : '' })}
          />
          Perecível
        </label>
        {values.isPerishable && (
          <div className="flex-1 space-y-1.5">
            <Label htmlFor={id('shelfLifeDays')}>Validade (dias)</Label>
            <Input
              id={id('shelfLifeDays')}
              type="number"
              min="1"
              step="1"
              value={values.shelfLifeDays}
              onChange={(e) => set('shelfLifeDays', e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id('notes')}>Observações</Label>
        <Input id={id('notes')} maxLength={2000} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <ProductImageInput value={values.imageUrl || null} onChange={(url) => set('imageUrl', url ?? '')} />
      </div>
    </>
  );
}
