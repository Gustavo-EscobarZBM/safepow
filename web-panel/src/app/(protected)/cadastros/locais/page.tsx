import { CatalogManager } from '@/components/catalog-manager';

export default function LossLocationsPage() {
  return (
    <CatalogManager
      resource="loss-locations"
      title="Local da Perda"
      description="Opções de local disponíveis ao registrar uma perda. Um local já usado em alguma perda não pode ser excluído."
      itemLabel="Local"
    />
  );
}
