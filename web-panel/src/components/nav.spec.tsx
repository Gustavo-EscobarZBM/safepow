import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Nav } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('Nav', () => {
  it('shows the official brand logo at the top of the sidebar', () => {
    render(<Nav user={{ id: '1', name: 'Ana', role: 'manager', companyId: 'c1' }} />);
    expect(screen.getByRole('img', { name: /safepow.*prevenção/i })).toBeInTheDocument();
  });

  it('marks the active manager link with aria-current="page"', () => {
    render(<Nav user={{ id: '1', name: 'Ana', role: 'manager', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /perdas/i })).not.toHaveAttribute('aria-current');
  });

  it('shows only the employee link for the employee role', () => {
    render(<Nav user={{ id: '2', name: 'João', role: 'employee', companyId: 'c1' }} />);
    expect(screen.getByRole('link', { name: /perdas/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /conferências/i })).not.toBeInTheDocument();
  });

  it('adds the confirmations link for the employee designated as verifier', () => {
    render(<Nav user={{ id: '3', name: 'Conferente', role: 'employee', companyId: 'c1', isLossVerifier: true }} />);
    expect(screen.getByRole('link', { name: /conferências/i })).toHaveAttribute('href', '/conferencias');
    expect(screen.getByRole('link', { name: /perdas/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });
});
