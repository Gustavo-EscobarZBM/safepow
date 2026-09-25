import { getSessionUser } from '@/lib/session';
import { AprovacoesClient } from './aprovacoes-client';

export default function AprovacoesPage() {
  const user = getSessionUser();
  return <AprovacoesClient currentUserId={user?.id ?? ''} />;
}
