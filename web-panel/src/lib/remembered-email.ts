const KEY = 'remembered-email';

// Só o e-mail, nunca a senha, e apenas se o usuário pedir. O storage pode estar
// bloqueado (modo privado, política do navegador): nesse caso a função só não lembra.
export function readRememberedEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveRememberedEmail(email: string): void {
  try {
    localStorage.setItem(KEY, email);
  } catch {
    // sem storage: seguir sem lembrar
  }
}

export function clearRememberedEmail(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // sem storage: nada a limpar
  }
}
