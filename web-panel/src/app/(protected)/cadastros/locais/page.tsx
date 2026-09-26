import { SimpleCatalogPage } from '@/components/resources/simple-catalog-page';

export default function LossLocationsPage() {
  return (
    <SimpleCatalogPage
      resource="loss-locations"
      auditEntityType="loss_location"
      title="Local da Perda"
      description="Opções de local disponíveis ao registrar uma perda. Um local já usado em alguma perda não pode ser excluído."
      itemLabel="Local"
    />
  );
}
