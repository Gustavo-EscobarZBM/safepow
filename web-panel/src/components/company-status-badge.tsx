import type { CompanyStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

const STYLES: Record<CompanyStatus, { label: string; className: string }> = {
  trial: { label: 'Em teste', className: 'bg-blue-100 text-blue-700' },
  active: { label: 'Ativo', className: 'border-transparent bg-success/15 text-success-foreground' },
  past_due: { label: 'Vencido', className: 'border-transparent bg-warning/25 text-warning-foreground' },
  blocked: { label: 'Bloqueado', className: 'border-transparent bg-destructive/15 text-destructive' },
  canceled: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
};

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const style = STYLES[status];
  return <Badge className={style.className}>{style.label}</Badge>;
}
