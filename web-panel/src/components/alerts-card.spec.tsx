import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsCard } from './alerts-card';
import type { LossAlert } from '@/lib/types';

const alerts: LossAlert[] = [
  { id: '1', severity: 'critical', title: 'Alerta crítico', description: 'Descrição 1' },
  { id: '2', severity: 'warning', title: 'Alerta de atenção', description: 'Descrição 2' },
  { id: '3', severity: 'info', title: 'Alerta informativo', description: 'Descrição 3' },
  { id: '4', severity: 'success', title: 'Alerta positivo', description: 'Descrição 4' },
];

describe('AlertsCard', () => {
  it('shows the empty message when there are no alerts', () => {
    render(<AlertsCard alerts={[]} />);
    expect(screen.getByText(/nenhum alerta no momento/i)).toBeInTheDocument();
  });

  it('shows only the first three alerts, with a dialog for the rest', async () => {
    render(<AlertsCard alerts={alerts} />);
    expect(screen.getByText('Alerta crítico')).toBeInTheDocument();
    expect(screen.getByText('Alerta de atenção')).toBeInTheDocument();
    expect(screen.getByText('Alerta informativo')).toBeInTheDocument();
    expect(screen.queryByText('Alerta positivo')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ver todos \(4\)/i }));
    expect(screen.getByText('Alerta positivo')).toBeInTheDocument();
  });
});
