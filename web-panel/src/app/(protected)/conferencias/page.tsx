import { getSessionUser } from '@/lib/session';
import { ConferenciasClient } from './conferencias-client';

export default function ConferenciasPage() {
  const user = getSessionUser();
  return <ConferenciasClient canConfigure={user?.role === 'manager'} />;
}
