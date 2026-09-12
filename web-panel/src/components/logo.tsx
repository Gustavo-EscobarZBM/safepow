import { cn } from '@/lib/utils';

/**
 * Placeholder até o arquivo oficial (exportado do Canva) ser recebido — ver
 * pendência no plano. Quando chegar, troca para <img src="/logo.svg" ... />
 * mantendo o mesmo slot de tamanho/padding no Nav e no Login.
 */
export function Logo({
  variant = 'dark',
  className,
}: {
  variant?: 'dark' | 'light';
  className?: string;
}) {
  const isDark = variant === 'dark';
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 40 40"
        aria-hidden="true"
        className={cn('h-8 w-8 shrink-0', isDark ? 'text-white' : 'text-primary')}
      >
        <path
          d="M20 2 L36 20 L20 38 L4 20 Z M20 10 L28 20 L20 30 L12 20 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <div className="leading-tight">
        <p
          className={cn(
            'font-display text-lg tracking-wide',
            isDark ? 'text-white' : 'text-primary',
          )}
        >
          SAFEPOW
        </p>
        <p
          className={cn(
            'text-[10px] font-medium uppercase tracking-wider',
            isDark ? 'text-white/60' : 'text-muted-foreground',
          )}
        >
          Prevenção &amp; Controle de perdas
        </p>
      </div>
    </div>
  );
}
