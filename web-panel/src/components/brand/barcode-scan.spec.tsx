import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarcodeScan } from './barcode-scan';

describe('BarcodeScan', () => {
  it('is exposed as a single described image, not as noise for screen readers', () => {
    render(<BarcodeScan />);

    expect(screen.getByRole('img', { name: /código de barras/i })).toHaveAttribute('data-state', 'idle');
  });

  it('switches to the success state after a successful sign-in', () => {
    render(<BarcodeScan state="success" />);

    expect(screen.getByRole('img', { name: /código de barras/i })).toHaveAttribute('data-state', 'success');
  });

  it('draws the read layer and the scan line', () => {
    render(<BarcodeScan />);

    expect(screen.getByTestId('scan-read')).toBeInTheDocument();
    expect(screen.getByTestId('scan-line')).toBeInTheDocument();
  });

  it('respects the reduced-motion preference by disabling the sweeping animation', () => {
    render(<BarcodeScan />);

    expect(screen.getByTestId('scan-line')).toHaveClass('motion-reduce:animate-none');
    expect(screen.getByTestId('scan-read')).toHaveClass('motion-reduce:animate-none');
  });
});
