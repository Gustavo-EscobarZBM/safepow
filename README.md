# SAFEPOW — Sistema de Controle de Perdas de Estoque

Sistema de controle e prevenção de perdas de estoque (quebra, vencimento, furto,
avarias) para pequenos e médios varejistas: registro de perdas pelo app mobile,
gestão pelo painel web, e um backend multi-tenant por trás dos dois.

## Como rodar

- Abra **[SAFEPOW.bat](./SAFEPOW.bat)** e escolha **1 — Iniciar**. A mesma opção instala e configura
  API e painel na primeira execução. Painel: http://localhost:3001.
- API e painel têm projetos Docker independentes: **7 — Somente API** e **8 — Somente painel**.
- Para o app no celular, use **9 — Conexão do celular** (Wi-Fi ou USB) e depois **4 — App Android**.
- Para gerar o arquivo APK sem conectar celular, escolha **10 — Gerar APK**.
- **Atualizar** e **Parar** permitem escolher o componente. O menu também oferece **Diagnosticar** e **Requisitos**.
- Guia rápido: [INSTALACAO.md](./INSTALACAO.md). Os scripts auxiliares ficam em `scripts/`.
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
