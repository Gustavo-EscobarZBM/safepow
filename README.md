# SAFEPOW — Sistema de Controle de Perdas de Estoque

Sistema de controle e prevenção de perdas de estoque (quebra, vencimento, furto,
avarias) para pequenos e médios varejistas: registro de perdas pelo app mobile,
gestão pelo painel web, e um backend multi-tenant por trás dos dois.

## 📄 Primeiro passo: leia o guia de configuração

**[Guia-de-Configuracao-SAFEPOW.docx](./Guia-de-Configuracao-SAFEPOW.docx)** — passo a
passo completo para colocar as três partes do projeto para rodar na sua máquina
(backend, painel web e app mobile), com contas de teste, fluxo de verificação
ponta a ponta e solução dos problemas mais comuns.

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
