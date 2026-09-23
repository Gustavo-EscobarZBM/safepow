import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo } from './logo';
import { FULL_PATH, MARK_PATH } from './brand/logo-paths';

describe('Logo', () => {
  it('renders the full lockup by default, reachable by its accessible name', () => {
    render(<Logo />);

    const logo = screen.getByRole('img', { name: /safepow.*prevenção/i });
    expect(logo).toHaveAttribute('viewBox', FULL_PATH.viewBox);
  });

  it('renders only the symbol when asked', () => {
    render(<Logo variant="mark" />);

    const logo = screen.getByRole('img', { name: 'SAFEPOW' });
    expect(logo).toHaveAttribute('viewBox', MARK_PATH.viewBox);
  });

  it('takes its color from the surrounding text color so it adapts to any surface', () => {
    const { container } = render(<Logo className="text-primary" />);

    expect(container.querySelector('path')).toHaveAttribute('fill', 'currentColor');
    expect(screen.getByRole('img')).toHaveClass('text-primary');
  });
});
