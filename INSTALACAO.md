# SAFEPOW — Instalação completa num computador Windows novo

Guia para **instalar do zero** o SAFEPOW (backend + painel web + app Android no emulador) e deixá-lo funcionando
como no ambiente original. Foi escrito para ser seguido por um assistente (Claude Code) junto com o dono do
computador — os passos marcados com 👤 **só a pessoa** pode fazer (senhas, aceitar termos, aprovar administrador,
reiniciar).

> **Para o Claude que vai instalar:** siga as fases em ordem, rode as verificações de cada fase antes de seguir e,
> se algo falhar, pare e diagnostique (não pule fases). Use o PowerShell. Depois de instalar um programa, **abra um
> novo terminal** (o PATH só é atualizado em terminais novos) ou recarregue o PATH com:
> `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

## Versões usadas no ambiente original

| Ferramenta | Versão |
|---|---|
| Windows | 10/11 64 bits |
| Git | 2.51 |
| Node.js | 24 (npm 11) |
| Docker Desktop | Docker 29 (motor WSL 2) |
| Flutter | 3.47.2, canal stable, instalado em `C:\flutter` |
| Android SDK | plataformas 34, 35 e 36; imagem de sistema `android-34 / google_apis / x86_64` |
| Emulador | AVD `flutter_emulator` (Pixel 6, Android 14, 2 GB de RAM) |

Requisitos do computador: **16 GB de RAM** (8 GB funciona, lento), **30 GB livres**, **virtualização ligada na BIOS**.

---

## Fase 0 — Virtualização e WSL 2

1. Conferir se a virtualização está ligada:
   ```powershell
   (Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled
   ```
   - `True` → segue.
   - `False` → 👤 a pessoa precisa ligar **Intel VT-x / AMD-V (SVM)** na BIOS/UEFI do computador e reiniciar.
2. Instalar o WSL 2 (o Docker Desktop precisa dele) — 👤 aprovar o pedido de administrador:
   ```powershell
   wsl --install --no-distribution
   ```
3. 👤 **Reiniciar o computador** se o comando pedir.
4. Verificar: `wsl --status` mostra "Versão padrão: 2".

## Fase 1 — Git, Node.js, Docker Desktop, Android Studio

Instalar pelo `winget` (👤 aprovar os pedidos de administrador que aparecerem):

```powershell
winget install --id Git.Git -e --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
winget install --id Google.AndroidStudio -e
winget install --id GitHub.cli -e
```

> `--accept-source-agreements` / termos de uso dos instaladores: 👤 confirme com a pessoa antes de aceitar.

Depois:
1. 👤 **Abrir o Docker Desktop uma vez**, aceitar os termos e esperar ficar "Engine running". Se pedir para
   reiniciar/sair e entrar de novo, faça.
2. Novo terminal e verificar:
   ```powershell
   git --version; node --version; npm --version; docker --version; docker info --format '{{.ServerVersion}}'
   ```
   Node precisa ser **24.x** (se vier outra versão maior, funciona; menor que 20 não).

## Fase 2 — Flutter em `C:\flutter`

O projeto e os scripts esperam o Flutter em `C:\flutter` (os scripts também procuram em outros lugares, mas este é
o padrão).

```powershell
git clone https://github.com/flutter/flutter.git -b stable C:\flutter
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';C:\flutter\bin', 'User')
```

Novo terminal e verificar:
```powershell
flutter --version
```
(Na primeira vez ele baixa o Dart; demora alguns minutos. Versão original: 3.47.2 — outra versão estável recente
também funciona; se `flutter pub get` reclamar da versão do SDK, rode `git -C C:\flutter checkout 3.47.2`.)

## Fase 3 — SDK do Android e emulador

1. 👤 Abrir o **Android Studio** uma vez e seguir o assistente inicial em modo **Standard** (ele baixa o SDK em
   `%LOCALAPPDATA%\Android\Sdk`). 👤 Aceitar as licenças que ele mostrar.
2. No Android Studio: **More Actions → SDK Manager**:
   - Aba **SDK Platforms**: marcar **Android 14.0 (API 34)** (e, se quiser igual ao original, 35 e 36).
   - Aba **SDK Tools**: marcar **Android SDK Command-line Tools (latest)**, **Android Emulator**,
     **Android SDK Platform-Tools**, **Android SDK Build-Tools**.
   - Aplicar.
3. Apontar o Flutter para o SDK e aceitar as licenças (👤 a pessoa responde `y`):
   ```powershell
   $sdk = "$env:LOCALAPPDATA\Android\Sdk"
   [Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
   flutter config --android-sdk $sdk
   flutter doctor --android-licenses
   ```
4. Criar o emulador com o mesmo nome e perfil do original:
   ```powershell
   $sdk = "$env:LOCALAPPDATA\Android\Sdk"
   & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" "system-images;android-34;google_apis;x86_64"
   & "$sdk\cmdline-tools\latest\bin\avdmanager.bat" create avd -n flutter_emulator -k "system-images;android-34;google_apis;x86_64" -d pixel_6
   ```
   (Se perguntar "custom hardware profile", responda `no`.) Alternativa: no Android Studio, **Device Manager →
   Create device → Pixel 6 → API 34 (Google APIs, x86_64)** e dar o nome `flutter_emulator`.
5. Verificar:
   ```powershell
   flutter doctor
   & "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds
   ```
   `flutter doctor` deve mostrar ✓ em Flutter e **Android toolchain**. (Visual Studio / Chrome / iOS podem ficar
   com aviso — não são usados.) A lista de AVDs deve ter `flutter_emulator`.

## Fase 4 — Baixar o projeto

O repositório é **privado**. 👤 A pessoa precisa entrar numa conta do GitHub com acesso ao repositório:
```powershell
gh auth login --web
```
(Escolher GitHub.com → HTTPS → autenticar no navegador. O código de uso único aparece no terminal.)

```powershell
New-Item -ItemType Directory -Force C:\PROJETOS | Out-Null
git clone https://github.com/Gustavo-EscobarZBM/safepow.git C:\PROJETOS\SAAS
```

> A pasta pode ser outra — os scripts usam a pasta onde estão. `C:\PROJETOS\SAAS` é a do ambiente original.

## Fase 5 — Instalar o projeto (dependências, containers, banco)

Na pasta do projeto:
```powershell
cd C:\PROJETOS\SAAS
powershell -NoProfile -ExecutionPolicy Bypass -File .\Instalar-SAFEPOW.ps1 -SemPausa
```
(A pessoa também pode dar duplo clique em **`INSTALAR PROJETO.bat`**.)

O instalador, em 6 passos:
1. confere Git, Node, npm, Docker e Flutter;
2. cria `backend\.env` e `web-panel\.env.local` a partir dos arquivos `.example` (se ainda não existirem);
3. `npm ci` no backend e no painel;
4. sobe os containers (Postgres na porta **5433**, Redis 6379, MinIO 9000/9001, backend 3000) com
   `docker compose up -d --build` — **a primeira vez demora** (baixa imagens e compila);
5. roda as migrations, cria o usuário **Master** (`npm run seed`) e a **Empresa Demo** com gerente e funcionário
   (`npm run seed:demo`) — banco limpo, sem dados de clientes;
6. `flutter pub get` no app.

Pode ser repetido sem estragar nada (migrations e seeds são idempotentes).

Verificação:
```powershell
docker ps --format "{{.Names}} {{.Status}}"          # backend-postgres-1 (healthy), backend-backend-1 Up, redis, minio
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/api   # 404 = API no ar
docker exec backend-postgres-1 psql -U postgres -d inventory_saas -tAc "SELECT email FROM users ORDER BY email"
```
A última linha deve listar `funcionario.demo@safepow.com`, `gerente.demo@safepow.com` e `master@seusistema.com.br`.

## Fase 6 — Primeiro uso

👤 A pessoa dá duplo clique em **`INICIAR PROJETO.bat`** (na raiz). Ele:
1. abre o Docker Desktop se precisar e sobe os containers (`--build`, com o código atual);
2. sobe o painel (`npm run dev`) na porta **3001** e abre o navegador em http://localhost:3001;
3. abre o emulador `flutter_emulator` (ou usa um celular Android conectado por USB com depuração ativada), faz
   `adb reverse tcp:3000` e roda o app com `flutter run` (a primeira compilação do app demora vários minutos).

Logs em `SAFEPOW-logs\painel.log` e `SAFEPOW-logs\mobile.log`. Para parar tudo: **`PARAR PROJETO.bat`**.

### Contas (banco limpo)

| Onde | Botão na tela de login | E-mail | Senha |
|---|---|---|---|
| Painel | Entrar como Administrador Master | master@seusistema.com.br | troque-esta-senha |
| Painel | Entrar como Gerente | gerente.demo@safepow.com | 123456 |
| App (celular) | — | funcionario.demo@safepow.com | demo1234 |

👤 No app do celular, a pessoa digita o e-mail e a senha do funcionário (o assistente não digita senhas).

### Verificação final (o que "funcionando" significa)
- Painel: login como Gerente → Dashboard abre; **Cadastros → Categorias/Marcas/Fornecedores** abrem; cadastrar um
  produto em **Cadastros → Produtos**.
- App: login do funcionário → **Escanear produto** → digitar o código de barras do produto criado → formulário de
  perda aparece → salvar → a perda aparece no painel em **Perdas**.

---

## Problemas conhecidos

| Sintoma | Causa / solução |
|---|---|
| `docker` não responde / "dockerDesktopLinuxEngine" | Docker Desktop fechado. Abrir e esperar "Engine running". |
| Migrations falham com "connection refused" na 5433 | Postgres ainda subindo — esperar `(healthy)` em `docker ps` e rodar o instalador de novo. |
| Painel mostra "erro de API" ou 404 em telas novas | O container do backend está com imagem antiga: `cd backend; docker compose up -d --build backend`. |
| Porta 5432 ocupada | Não é problema: o Postgres do projeto usa a **5433** no computador. |
| Emulador não abre / muito lento | Virtualização desligada na BIOS, ou pouca RAM. Conferir Fase 0; fechar outros programas. |
| `flutter run` falha em licenças | `flutter doctor --android-licenses` (👤 aceitar). |
| App não conecta no backend | Rodar `adb reverse tcp:3000 tcp:3000` (o INICIAR faz isso) e confirmar a API em http://localhost:3000/api. |
| Aviso de hidratação (`className ... dark`) no console do navegador | Conhecido e cosmético. |
| Cobrança (Stripe) não funciona | As chaves do Stripe **não** vão no repositório. Para usar, colocar `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` em `backend\.env` e em `backend\docker-compose.yml` (serviço `backend`) e rodar `docker compose up -d --build backend`. |

## Para desenvolver (opcional)

- Testes do backend: `cd backend; npm test` (unitários) e `npm run test:int` (integração — usa o Postgres do
  Docker e **recria** o banco `inventory_saas_test`; nunca rodar duas vezes ao mesmo tempo).
- Testes do painel: `cd web-panel; npx vitest run`. App: `cd mobile_app; flutter test`.
- Mudou o backend → `cd backend; docker compose up -d --build backend`.
- Migration nova → `cd backend; npm run migration:run` (fazer backup antes com
  `docker exec backend-postgres-1 pg_dump -U postgres -Fc inventory_saas > backup.dump`).
- Documentação de desenho e andamento: `docs/superpowers/specs/2026-09-20-cadastros-2-0-design-mestre.md`
  (seção 10). Próximo trabalho previsto: SP4 etapa 4.2.
