import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

export default function RootPage() {
  const user = getSessionUser();

  if (!user) redirect('/login');
  if (user.role === 'master_admin') redirect('/master/companies');
  if (user.role === 'employee') redirect('/losses');
  redirect('/dashboard');
}
