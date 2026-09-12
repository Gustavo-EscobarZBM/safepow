'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { AlertSeverity, LossAlert } from '@/lib/types';
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

const SEVERITY_STYLES: Record<AlertSeverity, { icon: LucideIcon; className: string }> = {
  critical: { icon: ShieldAlert, className: 'bg-destructive/15 text-destructive' },
  warning: { icon: AlertTriangle, className: 'bg-warning/15 text-warning-foreground' },
  success: { icon: CheckCircle2, className: 'bg-success/15 text-success-foreground' },
  info: { icon: Info, className: 'bg-accent text-accent-foreground' },
};

function AlertRow({ alert }: { alert: LossAlert }) {
  const { icon: Icon, className } = SEVERITY_STYLES[alert.severity];
  return (
    <div className="flex gap-3">
      <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', className)}>
        <Icon className="size-4" />
      </div>
      <div>
        <p className="font-semibold">{alert.title}</p>
        <p className="text-sm text-muted-foreground">{alert.description}</p>
      </div>
    </div>
  );
}

function AlertList({ alerts }: { alerts: LossAlert[] }) {
  return (
    <div className="flex flex-col gap-4">
      {alerts.map((alert, index) => (
        <div key={alert.id} className="contents">
          <AlertRow alert={alert} />
          {index < alerts.length - 1 && <Separator />}
        </div>
      ))}
    </div>
  );
}

export function AlertsCard({ alerts }: { alerts: LossAlert[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = alerts.slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alertas e recomendações</CardTitle>
        <CardDescription>O que merece atenção da sua equipe</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum alerta no momento — as perdas estão dentro do esperado.
          </p>
        ) : (
          <>
            <AlertList alerts={visible} />
            {alerts.length > visible.length && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setShowAll(true)}>
                Ver todos ({alerts.length})
              </Button>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Alertas e recomendações</DialogTitle>
            <DialogDescription>Todas as regras que dispararam para o período analisado.</DialogDescription>
          </DialogHeader>
          <AlertList alerts={alerts} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
