import type { LossByProductReportRow } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBRL } from '@/lib/format';

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
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Nenhuma perda registrada no período selecionado.
      </div>
    );
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
          const percent = total === 0 ? 0 : (financialLoss / total) * 100;
          return (
            <TableRow key={row.productId}>
              <TableCell className="font-display text-muted-foreground">{index + 1}</TableCell>
              <TableCell className="font-medium">{row.productName}</TableCell>
              <TableCell className="text-right">{Number(row.totalQuantity).toLocaleString('pt-BR')}</TableCell>
              <TableCell className="text-right">{formatBRL(financialLoss)}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
