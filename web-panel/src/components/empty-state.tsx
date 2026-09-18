import { cn } from '@/lib/utils';

export function EmptyState({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('flex h-40 items-center justify-center text-center text-sm text-muted-foreground', className)}>
      {message}
    </div>
  );
}
