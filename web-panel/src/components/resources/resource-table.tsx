import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface ResourceColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface ResourceTableProps<T extends { id: string }> {
  columns: ResourceColumn<T>[];
  rows: T[];
  loading: boolean;
  emptyText: string;
  actions?: (row: T) => ReactNode;
  actionsHeader?: string;
}

/**
 * Tabela de cadastro (motor de cadastros, SP2 2.4): carregando / vazio / linhas + coluna de ações opcional. Só
 * apresentação — quem usa busca os dados. Busca e paginação entram quando a primeira tela paginada migrar.
 */
export function ResourceTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  emptyText,
  actions,
  actionsHeader = 'Ações',
}: ResourceTableProps<T>) {
  const colSpan = columns.length + (actions ? 1 : 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key}>{column.header}</TableHead>
          ))}
          {actions && <TableHead className="text-right">{actionsHeader}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
              Carregando...
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
              {emptyText}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              {columns.map((column) => (
                <TableCell key={column.key} className={column.className}>
                  {column.render(row)}
                </TableCell>
              ))}
              {actions && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">{actions(row)}</div>
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
