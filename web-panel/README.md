# Painel Web — Sistema de Controle de Perdas de Estoque

Implementa a funcionalidade 2 (painel de gerência) e o Painel Master (Seção 6)
do documento de arquitetura.

## Stack e decisão de arquitetura

Next.js 14 (App Router) + TypeScript + Tailwind CSS + Recharts.

O painel funciona como um **BFF (Backend for Frontend)**: o navegador nunca
fala diretamente com a API do backend nem vê o token JWT.
- O login é feito por uma Route Handler do Next.js (`/api/auth/login`), que
  chama o backend e grava o token em um **cookie httpOnly** (inacessível a
  JavaScript — mitiga roubo de token via XSS).
- Todas as demais chamadas passam por um proxy genérico
  (`/api/backend/[...path]`), que lê o cookie no servidor e injeta o header
  `Authorization: Bearer ...` antes de encaminhar ao backend.
- Isso também elimina qualquer necessidade de configurar CORS entre o painel
  e a API.

## Como rodar localmente

Pré-requisito: o backend (`../backend`) já rodando (`docker compose up`, ver
o README dele) — por padrão em `http://localhost:3000/api`.

```bash
cp .env.example .env.local
npm install
npm run dev
```

O painel sobe em `http://localhost:3001` (porta diferente de propósito, já
que o backend também usa a 3000 por padrão).

Faça login com o usuário master admin criado pelo seed do backend, ou com o
gerente de uma empresa criada por ele.

## Build de produção

```bash
npm run build
npm run start
```

Ambos foram executados e verificados neste projeto antes da entrega — o
build gera 0 erros de tipo e todas as rotas ficam disponíveis (`/login`,
`/dashboard`, `/products`, `/losses`, `/master/companies`).

## Estrutura

```
src/
  middleware.ts                    # protege rotas: sem cookie de sessão -> redireciona para /login
  lib/
    session.ts                     # leitura/escrita do cookie httpOnly (só em código de servidor)
    api-client.ts                  # fetch client-side, sempre via /api/backend/*
    types.ts                       # tipos compartilhados (Product, Loss, Company...)
  app/
    login/page.tsx
    api/
      auth/login/route.ts          # troca credenciais por cookie httpOnly
      auth/logout/route.ts
      backend/[...path]/route.ts   # proxy genérico autenticado para o backend
    (protected)/
      layout.tsx                   # nav lateral + guarda de sessão
      dashboard/page.tsx           # gráficos gerenciais + filtro de período (Seção 2)
      products/page.tsx            # cadastro/listagem + importação de planilha (Seção 5)
      losses/page.tsx              # listagem + filtro de período + exportação (.xlsx)
      users/page.tsx               # gestão de usuários do tenant (convidar/desativar)
      master/companies/page.tsx    # Painel Master (Seção 6.1) — cadastro e bloqueio de empresas
  components/
    nav.tsx, kpi-card.tsx, losses-by-product-chart.tsx, company-status-badge.tsx, pagination.tsx
```

## O que ainda NÃO está implementado

- **Paginação de verdade no backend** — a paginação hoje é client-side (o
  componente `Pagination` fatia a lista já carregada); os endpoints ainda
  devolvem a lista inteira (até o limite de 500 do backend em `/losses`).
  Para catálogos/históricos muito grandes, o próximo passo é mover para
  `?page=&pageSize=` no backend.
- Testes automatizados (o build/tipo foi verificado, mas não há testes de
  componente/E2E ainda).
