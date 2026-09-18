import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuspiciousPatternsCard } from './suspicious-patterns-card';
import type { SuspiciousPatternEntry } from '@/lib/types';

const entries: SuspiciousPatternEntry[] = [
  { employeeId: '1', employeeName: 'Fulano', score: 60, reasons: ['Motivo 1'] },
];

describe('SuspiciousPatternsCard', () => {
  it('shows the empty message when there are no entries', () => {
    render(<SuspiciousPatternsCard entries={[]} />);
    expect(screen.getByText(/nenhum padrão fora do comum/i)).toBeInTheDocument();
  });

  it('renders the employee name, score and reasons, using the shared critical styling', () => {
    render(<SuspiciousPatternsCard entries={entries} />);
    expect(screen.getByText('Fulano')).toBeInTheDocument();
    expect(screen.getByText('60')).toHaveClass('bg-destructive/15', 'text-destructive');
    expect(screen.getByText('Motivo 1')).toBeInTheDocument();
  });
});
