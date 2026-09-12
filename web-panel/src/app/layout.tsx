import type { Metadata } from 'next';
import { Quicksand } from 'next/font/google';
import '@fontsource/chunk-five';
import './globals.css';
import { cn } from '@/lib/utils';

const quicksand = Quicksand({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'SAFEPOW — Controle de Perdas de Estoque',
  description: 'Painel gerencial do Sistema de Controle de Perdas de Estoque (SaaS)',
};

// Aplica a classe "dark" salva (ou a preferência do sistema, na primeira
// visita) antes da hidratação — sem isso a página pisca no tema claro por um
// instante mesmo para quem já escolheu o escuro.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={cn('font-sans', quicksand.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
