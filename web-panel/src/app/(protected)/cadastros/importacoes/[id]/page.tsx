import { getSessionUser } from '@/lib/session';
import { ImportWizard } from '@/components/imports/import-wizard';
import { ImportPageHeader } from '../import-page-header';

export default function ImportPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-6">
      <ImportPageHeader />
      <ImportWizard key={params.id} jobId={params.id} currentUserId={getSessionUser()?.id ?? ''} />
    </div>
  );
}
