import Link from 'next/link';

/** Cabeçalho das telas do assistente de importação (SP3). */
export function ImportPageHeader() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="font-display text-2xl text-foreground">Importar produtos</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro e atualização em massa por planilha, com simulação antes de gravar.
        </p>
      </div>
      <Link href="/cadastros/importacoes" className="text-sm text-primary underline-offset-4 hover:underline">
        Histórico de importações
      </Link>
    </div>
  );
}
