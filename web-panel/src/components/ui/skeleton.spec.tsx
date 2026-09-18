import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('renders a status element with an accessible label and the given classes', () => {
    render(<Skeleton className="h-4 w-24" />);
    const el = screen.getByRole('status', { name: 'Carregando' });
    expect(el).toHaveClass('h-4', 'w-24', 'animate-pulse');
  });
});
