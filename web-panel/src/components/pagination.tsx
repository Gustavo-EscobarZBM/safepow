'use client';

import { Button } from '@/components/ui/button';

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
