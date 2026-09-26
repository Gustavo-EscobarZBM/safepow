import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ResourceTable, type ResourceColumn } from './resource-table';

type Row = { id: string; name: string; price: number };
const COLUMNS: ResourceColumn<Row>[] = [
  { key: 'name', header: 'Nome', render: (row) => row.name, className: 'font-medium' },
  { key: 'price', header: 'Preço', render: (row) => `R$ ${row.price}` },
];
const ROWS: Row[] = [
  { id: 'a', name: 'Arroz', price: 10 },
  { id: 'b', name: 'Feijão', price: 8 },
];

describe('ResourceTable', () => {
  it('carregando', () => {
    render(<ResourceTable columns={COLUMNS} rows={[]} loading emptyText="Nada aqui." />);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(screen.queryByText('Nada aqui.')).not.toBeInTheDocument();
  });

  it('vazio', () => {
    render(<ResourceTable columns={COLUMNS} rows={[]} loading={false} emptyText="Nada aqui." />);
    expect(screen.getByText('Nada aqui.')).toBeInTheDocument();
  });

  it('uma linha por item com o render de cada coluna; sem actions não há coluna Ações', () => {
    render(<ResourceTable columns={COLUMNS} rows={ROWS} loading={false} emptyText="Nada aqui." />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Nome', 'Preço']);
    expect(screen.getByRole('row', { name: /Arroz/ })).toHaveTextContent('R$ 10');
    expect(screen.getByRole('row', { name: /Feijão/ })).toHaveTextContent('R$ 8');
  });

  it('com actions: cabeçalho "Ações" e o conteúdo por linha', () => {
    render(
      <ResourceTable
        columns={COLUMNS}
        rows={ROWS}
        loading={false}
        emptyText="Nada aqui."
        actions={(row) => <button>Editar {row.name}</button>}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Ações' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Arroz/ })).getByRole('button', { name: 'Editar Arroz' })).toBeInTheDocument();
  });
});
