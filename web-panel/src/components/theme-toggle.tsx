'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A classe "dark" já é aplicada antes da hidratação por um script inline em
 * layout.tsx (evita o "flash" do tema errado) — aqui só lemos esse estado
 * inicial e alternamos a classe + a preferência salva no clique.
 *
 * `iconOnly` cobre o botão flutuante da tela de login (fora da barra
 * lateral, onde o texto "Tema escuro/claro" não cabe/não combina).
 */
export function ThemeToggle({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  return (
    <Button
      type="button"
      onClick={toggle}
      variant="secondary"
      size={iconOnly ? 'icon' : 'sm'}
      className={cn(!iconOnly && 'w-full justify-center gap-1.5', className)}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
    >
      {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      {!iconOnly && (isDark ? 'Tema claro' : 'Tema escuro')}
    </Button>
  );
}
