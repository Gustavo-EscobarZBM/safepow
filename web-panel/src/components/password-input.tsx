'use client';

import * as React from 'react';
import { ArrowBigUp, Eye, EyeOff, Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'>;

/**
 * Campo de senha com botão de mostrar/ocultar e aviso de Caps Lock. O aviso some
 * quando o campo perde o foco (o estado do Caps Lock só é conhecido enquanto se digita).
 */
export function PasswordInput({ className, onKeyUp, onBlur, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);
  const [capsLock, setCapsLock] = React.useState(false);

  return (
    <div>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          {...props}
          type={visible ? 'text' : 'password'}
          className={cn(
            'h-10 border-foreground/70 pl-9 pr-10 focus-visible:ring-2 focus-visible:ring-ring/60 dark:border-foreground/25',
            className,
          )}
          onKeyUp={(event) => {
            setCapsLock(event.getModifierState('CapsLock'));
            onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <div aria-live="polite">
        {capsLock && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning-foreground">
            <ArrowBigUp className="size-3.5" aria-hidden="true" />
            Caps Lock está ativado
          </p>
        )}
      </div>
    </div>
  );
}
