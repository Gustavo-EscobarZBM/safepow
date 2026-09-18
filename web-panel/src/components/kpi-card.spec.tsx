import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiCard, KpiTile } from './kpi-card';

describe('KpiCard', () => {
  it('renders the label and value', () => {
    render(<KpiCard label="Prejuízo" value="R$ 100,00" />);
    expect(screen.getByText('Prejuízo')).toBeInTheDocument();
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
  });

  it('renders the hint when no variation is provided', () => {
    render(<KpiCard label="Itens" value="10" hint="Mês anterior: 8" />);
    expect(screen.getByText('Mês anterior: 8')).toBeInTheDocument();
  });

  it('renders a worse-variation badge in red when the percent is positive', () => {
    render(<KpiCard label="Prejuízo" value="R$ 100,00" variationPercent={12.3} />);
    expect(screen.getByText(/12,3% vs\. mês anterior/)).toHaveClass('text-destructive');
  });

  it('renders a better-variation badge in green when the percent is negative', () => {
    render(<KpiCard label="Prejuízo" value="R$ 100,00" variationPercent={-12.3} />);
    expect(screen.getByText(/12,3% vs\. mês anterior/)).toHaveClass('text-emerald-600');
  });
});

describe('KpiTile', () => {
  it('renders label, value and optional hint', () => {
    render(<KpiTile label="Produto mais perdido" value="Refrigerante 2L" hint="No período filtrado" />);
    expect(screen.getByText('Produto mais perdido')).toBeInTheDocument();
    expect(screen.getByText('Refrigerante 2L')).toBeInTheDocument();
    expect(screen.getByText('No período filtrado')).toBeInTheDocument();
  });

  it('omits the hint paragraph when none is given', () => {
    render(<KpiTile label="Itens" value="10" />);
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });
});
