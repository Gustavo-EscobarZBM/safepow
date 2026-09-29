import type { ResourceField } from './resource-form-dialog';
import type { Supplier } from '@/lib/types';

export interface TaxonomyPageConfig {
  resource: 'categories' | 'brands' | 'suppliers';
  auditEntityType: 'category' | 'brand' | 'supplier';
  fileBase: string;
  title: string;
  description: string;
  /** Minúsculo, para as frases: "marca", "categoria", "fornecedor". */
  singular: string;
  /** Coluna principal da tabela. */
  columnHeader: string;
  newLabel: string;
  emptyText: string;
  tabs: { active: string; archived: string };
  /** Campos do formulário (a categoria pai é acrescentada pela página quando `tree`). */
  fields: ResourceField[];
  /** Categorias: coluna com o caminho e campo "Categoria pai". */
  tree?: boolean;
  /** Colunas extras, na ordem, a partir dos campos do registro. */
  extraColumns?: { key: keyof Supplier; header: string }[];
}

export const CATEGORIES_PAGE: TaxonomyPageConfig = {
  resource: 'categories',
  auditEntityType: 'category',
  fileBase: 'categorias',
  title: 'Categorias',
  description: 'Até 3 níveis (ex.: Mercearia › Bebidas › Refrigerantes). Base do relatório de perdas por categoria.',
  singular: 'categoria',
  columnHeader: 'Categoria',
  newLabel: 'Nova categoria',
  emptyText: 'Nenhuma categoria cadastrada ainda.',
  tabs: { active: 'Ativas', archived: 'Arquivadas' },
  fields: [{ name: 'name', label: 'Nome', required: true }],
  tree: true,
};

export const BRANDS_PAGE: TaxonomyPageConfig = {
  resource: 'brands',
  auditEntityType: 'brand',
  fileBase: 'marcas',
  title: 'Marcas',
  description: 'Marcas dos produtos. Arquivar uma marca não mexe nos produtos que já a usam.',
  singular: 'marca',
  columnHeader: 'Marca',
  newLabel: 'Nova marca',
  emptyText: 'Nenhuma marca cadastrada ainda.',
  tabs: { active: 'Ativas', archived: 'Arquivadas' },
  fields: [{ name: 'name', label: 'Nome', required: true }],
};

export const SUPPLIERS_PAGE: TaxonomyPageConfig = {
  resource: 'suppliers',
  auditEntityType: 'supplier',
  fileBase: 'fornecedores',
  title: 'Fornecedores',
  description: 'Fornecedor principal de cada produto. Base do relatório de perdas por fornecedor (trocas e negociação).',
  singular: 'fornecedor',
  columnHeader: 'Fornecedor',
  newLabel: 'Novo fornecedor',
  emptyText: 'Nenhum fornecedor cadastrado ainda.',
  tabs: { active: 'Ativos', archived: 'Arquivados' },
  fields: [
    { name: 'name', label: 'Nome', required: true },
    { name: 'taxId', label: 'CNPJ/CPF' },
    { name: 'contactName', label: 'Contato' },
    { name: 'phone', label: 'Telefone' },
    { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'notes', label: 'Observações' },
  ],
  extraColumns: [
    { key: 'contactName', header: 'Contato' },
    { key: 'phone', header: 'Telefone' },
  ],
};
