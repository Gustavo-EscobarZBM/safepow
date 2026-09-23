import { cn } from '@/lib/utils';
import { FULL_PATH, MARK_PATH } from './brand/logo-paths';

const LABELS = {
  full: 'SAFEPOW — Prevenção e controle de perdas',
  mark: 'SAFEPOW',
} as const;

/**
 * Logo oficial da SAFEPOW (vetorizada a partir dos arquivos da marca). Usa
 * `currentColor`: a cor vem da classe de texto do contexto (`text-foreground`,
 * `text-sidebar-foreground`...), então funciona em qualquer tema ou fundo.
 * `full` = símbolo + nome + assinatura; `mark` = só o símbolo.
 */
export function Logo({ variant = 'full', className }: { variant?: 'full' | 'mark'; className?: string }) {
  const shape = variant === 'mark' ? MARK_PATH : FULL_PATH;

  return (
    <svg role="img" aria-label={LABELS[variant]} viewBox={shape.viewBox} className={cn('block h-auto', className)}>
      <path fill="currentColor" fillRule="evenodd" d={shape.d} />
    </svg>
  );
}
