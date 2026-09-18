'use client';

import { useState } from 'react';
import type { SuspiciousPatternEntry } from '@/lib/types';
import { scoreToSeverity, SEVERITY_STYLES } from '@/lib/severity';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

function PatternRow({ entry }: { entry: SuspiciousPatternEntry }) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
          SEVERITY_STYLES[scoreToSeverity(entry.score)].className,
        )}
      >
        {entry.score}
      </div>
      <div>
        <p className="font-semibold">{entry.employeeName}</p>
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
          {entry.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PatternList({ entries }: { entries: SuspiciousPatternEntry[] }) {
  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry, index) => (
        <div key={entry.employeeId} className="contents">
          <PatternRow entry={entry} />
          {index < entries.length - 1 && <Separator />}
        </div>
      ))}
    </div>
  );
}

export function SuspiciousPatternsCard({ entries }: { entries: SuspiciousPatternEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = entries.slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Padrões para revisar</CardTitle>
        <CardDescription>Sinais cruzados por funcionário — não é acusação, é um ponto de partida</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum padrão fora do comum no período.</p>
        ) : (
          <>
            <PatternList entries={visible} />
            {entries.length > visible.length && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setShowAll(true)}>
                Ver todos ({entries.length})
              </Button>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Padrões para revisar</DialogTitle>
            <DialogDescription>Todos os funcionários com algum sinal no período analisado.</DialogDescription>
          </DialogHeader>
          <PatternList entries={entries} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
