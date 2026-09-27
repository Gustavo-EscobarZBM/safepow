import { ImportWizard } from '@/components/imports/import-wizard';
import { ImportPageHeader } from '../import-page-header';

export default function NewImportPage() {
  return (
    <div className="space-y-6">
      <ImportPageHeader />
      <ImportWizard />
    </div>
  );
}
