import { BellRing, ShieldCheck, Smartphone, type LucideIcon } from 'lucide-react';
import { BarcodeScan } from '@/components/brand/barcode-scan';
import { Logo } from '@/components/logo';

const BENEFITS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Smartphone,
    title: 'Registro no celular',
    description: 'Foto e motivo na hora, mesmo sem internet.',
  },
  {
    icon: ShieldCheck,
    title: 'Conferência de descarte',
    description: 'Um segundo responsável confirma as perdas registradas.',
  },
  {
    icon: BellRing,
    title: 'Alertas e padrões',
    description: 'O painel destaca o que foge do normal.',
  },
];

// Painel de marca da tela de login. Segue o tema do app (claro no claro, verde-petróleo
// no escuro) e só aparece a partir de lg — em telas menores o formulário mostra a logo.
export function BrandPanel({ status }: { status: 'idle' | 'success' }) {
  return (
    <aside className="hidden flex-col justify-between gap-10 bg-accent p-10 text-foreground dark:bg-sidebar lg:flex xl:p-14">
      <Logo className="w-56 text-foreground" />

      <div className="max-w-md space-y-8">
        <h2 className="font-display text-4xl leading-tight xl:text-5xl">Saiba onde o seu estoque está escapando.</h2>
        <ul className="space-y-4">
          {BENEFITS.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-foreground/80">
                <span className="font-semibold text-foreground">{title}</span>
                <br />
                {description}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <BarcodeScan state={status} />
    </aside>
  );
}
