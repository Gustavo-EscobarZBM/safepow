'use client';

import { useMemo } from 'react';
import { buildBarcodeBars } from '@/lib/barcode';
import { cn } from '@/lib/utils';

const WIDTH = 300;
const HEIGHT = 80;

/**
 * Código de barras "sendo lido": uma linha dourada varre as barras e revela, por
 * trás dela, a camada escura (lida). Em `success` faz uma leitura única e rápida,
 * confirmando o login enquanto o painel carrega. Com prefers-reduced-motion fica
 * parado, com a leitura já em ~62%.
 */
export function BarcodeScan({ state = 'idle', className }: { state?: 'idle' | 'success'; className?: string }) {
  const bars = useMemo(() => buildBarcodeBars(7, WIDTH), []);

  const layer = (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={HEIGHT} fill="currentColor" />
      ))}
    </svg>
  );

  return (
    <div
      role="img"
      aria-label="Código de barras sendo lido"
      data-state={state}
      className={cn('group/scan relative h-20 w-full overflow-hidden', className)}
    >
      <div className="absolute inset-0 text-foreground/25">{layer}</div>
      <div
        data-testid="scan-read"
        className="absolute inset-0 animate-scan-read text-foreground [clip-path:inset(0_100%_0_0)] group-data-[state=success]/scan:animate-scan-read-once motion-reduce:animate-none motion-reduce:[clip-path:inset(0_38%_0_0)]"
      >
        {layer}
      </div>
      <div
        data-testid="scan-line"
        className="absolute inset-y-0 left-0 w-0.5 animate-scan-line bg-chart-2 group-data-[state=success]/scan:animate-scan-line-once motion-reduce:left-[62%] motion-reduce:animate-none dark:bg-[#E0C45C]"
      />
    </div>
  );
}
