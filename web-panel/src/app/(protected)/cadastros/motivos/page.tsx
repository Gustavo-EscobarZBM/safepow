import { CatalogManager } from '@/components/catalog-manager';

export default function LossReasonsPage() {
  return (
    <CatalogManager
      resource="loss-reasons"
      title="Motivo da Perda"
      description="Opções de motivo disponíveis ao registrar uma perda. Um motivo já usado em alguma perda não pode ser excluído."
      itemLabel="Motivo"
    />
  );
}
