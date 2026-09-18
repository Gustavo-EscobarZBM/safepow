import type { LossByProductReportRow } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBRL } from '@/lib/format';
import { percentOfTotal } from '@/lib/table-metrics';

export function TopOffendersTable({
  data,
  limit = 10,
  total: totalOverride,
}: {
  data: LossByProductReportRow[];
  limit?: number;
  /** Base para o cálculo de "% do total" — use quando `data` for um subconjunto filtrado. */
  total?: number;
}) {
  const rows = data.slice(0, limit);
  const total = totalOverride ?? data.reduce((sum, row) => sum + Number(row.totalFinancialLoss), 0);

  if (rows.length === 0) {
    return <EmptyState message="Nenhuma perda registrada no período selecionado." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Produto</TableHead>
          <TableHead className="text-right">Quantidade</TableHead>
          <TableHead className="text-right">Prejuízo</TableHead>
          <TableHead className="text-right">% do total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const financialLoss = Number(row.totalFinancialLoss);
          const percent = percentOfTotal(financialLoss, total);
          return (
            <TableRow key={row.productId}>
              <TableCell className="font-display text-muted-foreground">{index + 1}</TableCell>
              <TableCell className="font-medium">{row.productName}</TableCell>
              <TableCell className="text-right">{Number(row.totalQuantity).toLocaleString('pt-BR')}</TableCell>
              <TableCell className="text-right">{formatBRL(financialLoss)}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      data-testid="offender-bar"
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
