import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { Nav } from '@/components/nav';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="flex">
      <Nav user={user} />
      <main className="flex-1 overflow-y-auto bg-muted/30 p-8">{children}</main>
    </div>
  );
}
