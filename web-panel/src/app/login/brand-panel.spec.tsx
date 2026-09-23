import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandPanel } from './brand-panel';

describe('BrandPanel', () => {
  it('shows the brand, the headline and the three real product benefits', () => {
    render(<BrandPanel status="idle" />);

    expect(screen.getByRole('img', { name: /safepow.*prevenção/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /saiba onde o seu estoque está escapando/i })).toBeInTheDocument();
    expect(screen.getByText('Registro no celular')).toBeInTheDocument();
    expect(screen.getByText('Conferência de descarte')).toBeInTheDocument();
    expect(screen.getByText('Alertas e padrões')).toBeInTheDocument();
  });

  it('follows the app theme instead of forcing a dark surface in light mode', () => {
    const { container } = render(<BrandPanel status="idle" />);

    const panel = container.firstElementChild;
    expect(panel).toHaveClass('bg-accent', 'text-foreground', 'dark:bg-sidebar');
    expect(panel).not.toHaveClass('bg-sidebar');
  });

  it('passes the sign-in status on to the barcode animation', () => {
    render(<BrandPanel status="success" />);

    expect(screen.getByRole('img', { name: /código de barras/i })).toHaveAttribute('data-state', 'success');
  });
});
