import { AlertTriangle, CheckCircle2, Info, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { AlertSeverity } from '@/lib/types';

export const SEVERITY_STYLES: Record<AlertSeverity, { icon: LucideIcon; className: string }> = {
  critical: { icon: ShieldAlert, className: 'bg-destructive/15 text-destructive' },
  warning: { icon: AlertTriangle, className: 'bg-warning/15 text-warning-foreground' },
  success: { icon: CheckCircle2, className: 'bg-success/15 text-success-foreground' },
  info: { icon: Info, className: 'bg-accent text-accent-foreground' },
};

export function scoreToSeverity(score: number): AlertSeverity {
  if (score >= 50) return 'critical';
  if (score >= 25) return 'warning';
  return 'info';
}
