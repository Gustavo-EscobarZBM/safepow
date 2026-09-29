# SAFEPOW — Sistema de Controle de Perdas de Estoque

Sistema de controle e prevenção de perdas de estoque (quebra, vencimento, furto,
avarias) para pequenos e médios varejistas: registro de perdas pelo app mobile,
gestão pelo painel web, e um backend multi-tenant por trás dos dois.

## Como rodar

- **Instalar num computador Windows novo (do zero, com Docker e emulador):** siga
  [INSTALACAO.md](./INSTALACAO.md) — depois, `INSTALAR PROJETO.bat` uma vez.
- **Dia a dia:** `INICIAR PROJETO.bat` (sobe Docker, backend, painel em http://localhost:3001 e o app no
  emulador) e `PARAR PROJETO.bat`.
- Detalhes de cada parte no próprio README (links na tabela abaixo).

## Estrutura do repositório

| Pasta | O quê | Stack | Mais detalhes |
|---|---|---|---|
| [`backend/`](./backend) | API multi-tenant | NestJS + PostgreSQL (Row Level Security) | [backend/README.md](./backend/README.md) |
| [`web-panel/`](./web-panel) | Painel de gestão (gerente) | Next.js + Tailwind | [web-panel/README.md](./web-panel/README.md) |
| [`mobile_app/`](./mobile_app) | App do funcionário (registro de perdas) | Flutter, offline-first | [mobile_app/README.md](./mobile_app/README.md) |
| [`docs/`](./docs) | Documentação de arquitetura e planos de evolução | — | — |

## Contribuindo

1. `git pull` antes de começar.
2. Crie um branch descritivo: `git checkout -b minha-mudanca`.
3. Commits pequenos e com mensagem clara.
4. `git push -u origin minha-mudanca` e abra um Pull Request para `main`.

Nunca commite `.env`/`.env.local` nem segredos reais — os arquivos de exemplo
(`.env.example`) já mostram o que cada parte precisa configurar.
