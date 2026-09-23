import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriceHistoryTimeline } from './price-history-timeline';
import type { PriceHistoryEntry } from '@/lib/types';

function entry(overrides: Partial<PriceHistoryEntry> = {}): PriceHistoryEntry {
  return {
    id: 'h-1',
    unitPrice: 12,
    costPrice: 6,
    validFrom: '2026-09-10T17:05:00.000Z',
    source: 'manual',
    changedByUserId: 'u-1',
    changedByName: 'Gerente Maria',
    ...overrides,
  };
}

describe('PriceHistoryTimeline', () => {
  it('mostra o estado de carregamento', () => {
    render(<PriceHistoryTimeline entries={[]} loading error={null} />);
    expect(screen.getByText(/carregando histórico de preços/i)).toBeInTheDocument();
  });

  it('mostra o erro', () => {
    render(<PriceHistoryTimeline entries={[]} loading={false} error="Falhou" />);
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('mostra a mensagem de vazio', () => {
    render(<PriceHistoryTimeline entries={[]} loading={false} error={null} />);
    expect(screen.getByText(/nenhuma mudança de preço registrada/i)).toBeInTheDocument();
  });

  it('lista preço, custo, origem e quem alterou, na ordem recebida', () => {
    render(
      <PriceHistoryTimeline
        entries={[entry(), entry({ id: 'h-2', unitPrice: 10, costPrice: 5, source: 'import', changedByName: null })]}
        loading={false}
        error={null}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/12,00/);
    expect(items[0]).toHaveTextContent(/custo R\$\s6,00/i);
    expect(items[0]).toHaveTextContent('Manual');
    expect(items[0]).toHaveTextContent('por Gerente Maria');
    expect(items[1]).toHaveTextContent(/10,00/);
    expect(items[1]).toHaveTextContent('Importação');
  });

  it('sem autor conhecido não escreve "por null" nem "por undefined"', () => {
    render(<PriceHistoryTimeline entries={[entry({ changedByName: null })]} loading={false} error={null} />);
    expect(screen.getByRole('listitem')).not.toHaveTextContent(/por /);
  });

  it('a linha do backfill aparece como "Registro inicial"', () => {
    render(
      <PriceHistoryTimeline entries={[entry({ source: 'backfill', changedByName: null })]} loading={false} error={null} />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Registro inicial');
  });

  it('a lista rola dentro de uma área de altura limitada (histórico de até 100 linhas)', () => {
    render(<PriceHistoryTimeline entries={[entry()]} loading={false} error={null} />);
    expect(screen.getByRole('list', { name: /histórico de preços/i })).toHaveClass('max-h-56', 'overflow-y-auto');
  });
});
