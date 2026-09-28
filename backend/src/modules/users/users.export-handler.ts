import { getTenantContext } from '../../common/tenant/tenant-storage';
import { ExportResourceHandler } from '../exports/export-handler';
import { User, UserRole } from './user.entity';

type UserExportRow = Pick<User, 'id' | 'name' | 'email' | 'role' | 'isActive' | 'createdAt'>;

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  [UserRole.MANAGER]: 'Gerente',
  [UserRole.EMPLOYEE]: 'Funcionário',
};

/** Colunas lidas: nunca o hash da senha. Empresa pelo contexto além da RLS (master não tem empresa). */
function baseQuery(manager: Parameters<ExportResourceHandler<UserExportRow>['count']>[0]) {
  return manager
    .createQueryBuilder(User, 'u')
    .select(['u.id', 'u.name', 'u.email', 'u.role', 'u.isActive', 'u.createdAt'])
    .where('u.companyId = :companyId', { companyId: getTenantContext().companyId });
}

/** Exportação de usuários da empresa (SP3, 3.3). */
export const usersExportHandler: ExportResourceHandler<UserExportRow> = {
  fileBase: 'usuarios',
  sheetName: 'Usuários',
  columns: [
    { header: 'Nome', type: 'text', width: 30, value: (u) => u.name },
    { header: 'E-mail', type: 'text', width: 34, value: (u) => u.email },
    { header: 'Papel', type: 'text', width: 14, value: (u) => ROLE_LABELS[u.role] ?? u.role },
    { header: 'Situação', type: 'text', width: 12, value: (u) => (u.isActive ? 'Ativo' : 'Inativo') },
    { header: 'Criado em', type: 'datetime', width: 18, value: (u) => u.createdAt },
  ],
  count: (manager) => baseQuery(manager).getCount(),
  page(manager, _filters, afterId, limit) {
    const qb = baseQuery(manager);
    if (afterId) qb.andWhere('u.id > :afterId', { afterId });
    return qb.orderBy('u.id', 'ASC').take(limit).getMany();
  },
};
