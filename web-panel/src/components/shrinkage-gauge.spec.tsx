import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShrinkageGauge } from './shrinkage-gauge';

describe('ShrinkageGauge', () => {
  it('renders the good status for a healthy rate', () => {
    render(<ShrinkageGauge rate={0.8} />);
    expect(screen.getByTestId('shrinkage-gauge')).toHaveAttribute('data-status', 'good');
    expect(screen.getByText(/saudável/i)).toBeInTheDocument();
  });

  it('renders the critical status for a high rate', () => {
    render(<ShrinkageGauge rate={3} />);
    expect(screen.getByTestId('shrinkage-gauge')).toHaveAttribute('data-status', 'critical');
    expect(screen.getByText(/alto/i)).toBeInTheDocument();
  });

  it('renders the unknown state when no rate is informed', () => {
    render(<ShrinkageGauge rate={null} />);
    expect(screen.getByTestId('shrinkage-gauge')).toHaveAttribute('data-status', 'unknown');
    expect(screen.getByText('Sem dado')).toBeInTheDocument();
  });
});
