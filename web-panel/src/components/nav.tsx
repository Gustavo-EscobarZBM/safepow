'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronDown,
  LayoutDashboard,
  ClipboardList,
  AlertTriangle,
  Users,
  Building2,
  LogOut,
  ShieldCheck,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { SessionUser } from '@/lib/types';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

type NavLeaf = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; icon: LucideIcon; children: { href: string; label: string }[] };
type NavItem = NavLeaf | NavGroup;

function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

const MANAGER_LINKS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    label: 'Cadastros',
    icon: ClipboardList,
    children: [
      { href: '/cadastros/produtos', label: 'Produtos' },
      { href: '/cadastros/motivos', label: 'Motivo da Perda' },
      { href: '/cadastros/locais', label: 'Local da Perda' },
    ],
  },
  { href: '/losses', label: 'Perdas', icon: AlertTriangle },
  { href: '/conferencias', label: 'Conferências', icon: ShieldCheck },
  { href: '/users', label: 'Usuários', icon: Users },
];

// Funcionário só registra perdas — sem acesso a dashboard, cadastros ou usuários.
const EMPLOYEE_LINKS: NavItem[] = [{ href: '/losses', label: 'Perdas', icon: AlertTriangle }];

// Funcionário designado como conferente pelo gerente também confirma perdas pendentes.
const VERIFIER_LINK: NavItem = { href: '/conferencias', label: 'Conferências', icon: ShieldCheck };

const MASTER_LINKS: NavItem[] = [
  { href: '/master/companies', label: 'Empresas (Painel Master)', icon: Building2 },
];

export function Nav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const employeeLinks = user.isLossVerifier ? [...EMPLOYEE_LINKS, VERIFIER_LINK] : EMPLOYEE_LINKS;
  const links =
    user.role === 'master_admin' ? MASTER_LINKS : user.role === 'employee' ? employeeLinks : MANAGER_LINKS;

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="sticky top-0 flex h-screen w-64 shrink-0 flex-col justify-between overflow-y-auto bg-sidebar text-sidebar-foreground print:hidden">
      <div>
        <div className="px-6 py-7">
          <Logo className="w-full text-sidebar-foreground" />
        </div>
        <div className="flex flex-col gap-1 px-4">
          {links.map((link) => {
            if (isGroup(link)) {
              const groupActive = link.children.some((child) => pathname.startsWith(child.href));
              const Icon = link.icon;
              return (
                <Collapsible key={link.label} defaultOpen={groupActive}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors',
                        groupActive
                          ? 'font-medium text-sidebar-foreground'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex-1 text-left">{link.label}</span>
                      <ChevronDown className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-1 py-1 pl-[1.85rem]">
                    {link.children.map((child) => {
                      const active = pathname.startsWith(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'rounded-lg border-l-2 px-3 py-2 text-sm transition-colors',
                            active
                              ? 'border-l-sidebar-primary-foreground bg-sidebar-accent font-medium text-sidebar-foreground'
                              : 'border-l-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              );
            }

            const active = pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-l-sidebar-primary-foreground bg-sidebar-accent font-medium text-sidebar-foreground'
                    : 'border-l-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="border-t border-sidebar-border px-5 py-4">
        <p className="mb-0.5 truncate text-sm font-medium">{user.name}</p>
        <p className="mb-3 text-xs capitalize text-sidebar-foreground/60">
          {user.role.replace('_', ' ')}
        </p>
        <div className="flex flex-col gap-2">
          <Link
            href="/perfil"
            aria-current={pathname.startsWith('/perfil') ? 'page' : undefined}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
              pathname.startsWith('/perfil')
                ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
                : 'bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground',
            )}
          >
            <UserCog className="size-3.5" />
            Meu perfil
          </Link>
          <ThemeToggle />
          <Button
            onClick={handleLogout}
            variant="secondary"
            size="sm"
            className="w-full justify-center gap-1.5"
          >
            <LogOut className="size-3.5" />
            Sair
          </Button>
        </div>
      </div>
    </nav>
  );
}
