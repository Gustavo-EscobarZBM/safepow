import { SimpleCatalogPage } from '@/components/resources/simple-catalog-page';

export default function LossReasonsPage() {
  return (
    <SimpleCatalogPage
      resource="loss-reasons"
      auditEntityType="loss_reason"
      title="Motivo da Perda"
      description="Opções de motivo disponíveis ao registrar uma perda. Um motivo já usado em alguma perda não pode ser excluído."
      itemLabel="Motivo"
    />
  );
}
