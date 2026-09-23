import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('hides the password by default and lets the user reveal and hide it', async () => {
    render(<PasswordInput id="password" aria-label="Senha" />);
    const input = screen.getByLabelText('Senha');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('warns when Caps Lock is on while typing, and stops warning when it is off', () => {
    render(<PasswordInput id="password" aria-label="Senha" />);
    const input = screen.getByLabelText('Senha');

    fireEvent.keyUp(input, { key: 'a', modifierCapsLock: true });
    expect(screen.getByText(/caps lock está ativado/i)).toBeInTheDocument();

    fireEvent.keyUp(input, { key: 'a', modifierCapsLock: false });
    expect(screen.queryByText(/caps lock está ativado/i)).not.toBeInTheDocument();
  });

  it('drops the Caps Lock warning when the field loses focus', () => {
    render(<PasswordInput id="password" aria-label="Senha" />);
    const input = screen.getByLabelText('Senha');

    fireEvent.keyUp(input, { key: 'a', modifierCapsLock: true });
    fireEvent.blur(input);

    expect(screen.queryByText(/caps lock está ativado/i)).not.toBeInTheDocument();
  });

  it('forwards value, change handler and validation attributes to the input', async () => {
    const onChange = vi.fn();
    render(<PasswordInput id="password" aria-label="Senha" value="segredo" onChange={onChange} required minLength={6} />);
    const input = screen.getByLabelText('Senha');

    expect(input).toHaveValue('segredo');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('minLength', '6');

    await userEvent.type(input, 'x');
    expect(onChange).toHaveBeenCalled();
  });
});
