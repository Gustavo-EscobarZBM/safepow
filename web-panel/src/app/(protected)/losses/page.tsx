import { getSessionUser } from '@/lib/session';
import { LossesClient } from './losses-client';

export default function LossesPage() {
  const user = getSessionUser();
  return <LossesClient role={user?.role ?? 'employee'} />;
}
