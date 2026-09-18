import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the given message', () => {
    render(<EmptyState message="Nenhum dado no período." />);
    expect(screen.getByText('Nenhum dado no período.')).toBeInTheDocument();
  });

  it('merges a custom className with the default layout classes', () => {
    render(<EmptyState message="Vazio" className="h-72" />);
    expect(screen.getByText('Vazio')).toHaveClass('h-72');
  });
});
