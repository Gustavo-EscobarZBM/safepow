# SAFEPOW: referência técnica da instalação local

Para instalar e usar pelo menu, consulte o [guia rápido](../INSTALACAO.md).
Os caminhos e comandos abaixo são relativos à raiz do projeto.

Abra **SAFEPOW.bat**. Não é necessário domínio nem servidor externo: os containers rodam no computador.

| Opção | O que faz |
|---|---|
| **1 — Iniciar API + painel** | Prepara e inicia os dois projetos Docker. |
| **2 — Atualizar** | Escolha API, painel ou ambos. Recompila o código local; não faz git pull. |
| **3 — Diagnosticar** | Mostra separadamente o estado da API, do painel e o log do app. |
| **4 — App Android** | Compila, instala e abre o app no dispositivo conectado. |
| **5 — Parar** | Escolha API, painel, app ou tudo. Preserva os dados. |
| **6 — Requisitos** | Mostra o que precisa estar instalado e procura as ferramentas. |
| **7 — Somente API** | Inicia a API com banco, Redis e armazenamento; não inicia nem recompila o painel. |
| **8 — Somente painel** | Inicia o frontend; não inicia nem altera a API. |
| **9 — Conexão do celular** | Configura Wi-Fi ou USB e o endereço da API usado pelo app. |
| **10 — Gerar APK** | Compila o APK de desenvolvimento, sem conectar celular. Mostra o arquivo gerado. |
| **0 — Sair** | Fecha o menu; os serviços continuam ligados. |

## Como as partes se conectam

- **API:** `backend/docker-compose.yml`, projeto Docker `backend`. Possui PostgreSQL, Redis e arquivos.
- **Painel:** `web-panel/docker-compose.yml`, projeto Docker `safepow-web`. Acessa a API por `http://safepow-api:3000/api` na rede Docker `safepow-local`.
- **App:** instalado no Android. Acessa a API pelo IP do computador via Wi-Fi ou pelo encaminhamento USB.

A rede compartilhada é criada pelo menu. O banco e o Redis não entram na rede do painel.
Os volumes existentes `backend_postgres_data` e `backend_minio_data` são preservados.
O painel antigo da instalação conjunta é parado e fica com reinício automático desativado.

O painel pode abrir sem a API, mas login e dados precisam dela. Atualizar/parar apenas um componente
não atualiza/para o outro. O computador precisa estar ligado para login e sincronização do app.

## Primeira execução

1. Abra `SAFEPOW.bat` e escolha **1**. Espere a API e o painel ficarem prontos.
2. Acesse **http://localhost:3001**.
3. Para usar o celular, escolha **9**, configure a conexão e siga os passos abaixo.

O menu tenta instalar Docker Desktop pelo winget se faltar. Autorizações do Windows, configuração inicial
do Docker, WSL/virtualização e reinicializações podem exigir sua intervenção. A primeira compilação requer internet.
Node.js, npm e os serviços de banco/arquivos ficam nos containers; não precisam de instalação separada no Windows.

Em uma instalação nova, as credenciais padrão do administrador são `master@seusistema.com.br` / `troque-esta-senha`.
Consulte `MASTER_ADMIN_EMAIL` e `MASTER_ADMIN_PASSWORD` no `.env` se já foram personalizadas.
Alterar essas variáveis não redefine a senha de uma conta existente.

## Celular pelo Wi-Fi

1. Conecte computador e celular à **mesma rede local** (o computador também pode usar Ethernet).
2. Escolha **9 → Wi-Fi**. O menu encontra o IP; se houver mais de uma rede, pede para escolher.
3. Autorize o pedido do Windows para criar regras de firewall da API e das imagens.
   As regras permitem apenas a sub-rede local, com o perfil **Privado**. Se o Wi-Fi estiver como Público,
   altere para Privado nas Configurações de Rede do Windows somente se for uma rede de confiança.
4. Escolha **7** para aplicar a configuração aos containers da API.
5. No navegador do celular, abra o endereço mostrado, por exemplo `http://192.168.0.103:3000/api/health`.
   Ele deve responder com `status: ok`. Rede de convidados/isolamento de clientes pode impedir o acesso.
6. Conecte o celular por USB para instalar, autorize a depuração e escolha **4**. Mantenha a tela desbloqueada
   e aceite a instalação se solicitado. `INSTALL_FAILED_USER_RESTRICTED` indica que o Android bloqueou/cancelou a instalação.
7. Depois de instalado, abra o SAFEPOW pelo ícone. A comunicação com a API usa o Wi-Fi; o cabo é dispensável.
   A sessão de depuração do Flutter pode terminar ao desconectar o cabo.

O app é compilado com esse endereço. Se o IP mudar, repita **9 → 7 → 4**; reservar o IP no roteador evita isso.
As URLs de imagens novas usam o IP configurado. Fotos antigas salvas com outro endereço não são reescritas automaticamente.

## Alternativa: celular pelo USB

Escolha **9 → USB**, depois **7** e **4**. O script encaminha API e imagens por `adb reverse`.
Nesse modo, o cabo precisa continuar conectado para login e sincronização.
O app pode registrar perdas offline após carregar sessão e catálogo; sincroniza quando a conexão voltar e estiver aberto.

Flutter, SDK/JDK Android, licenças e um dispositivo/emulador são necessários apenas para compilar/instalar o app.
A primeira compilação Android pode demorar vários minutos. A opção 4 mostra o progresso e aguarda a confirmação do Flutter.

## Configurações independentes

| Parte | Arquivo local | Exemplo versionado |
|---|---|---|
| API e serviços | `backend/.env` | `backend/.env.example` |
| Painel Docker | `web-panel/.env.docker` | `web-panel/.env.docker.example` |
| App | `mobile_app/env.local.json` | `mobile_app/env.example.json` |

O menu cria os arquivos quando necessário. `.env.local` do painel continua reservado ao `npm run dev` fora do Docker.
`API_BIND_ADDRESS` e `STORAGE_BIND_ADDRESS` controlam a publicação no host: USB usa `127.0.0.1`, Wi-Fi usa `0.0.0.0`.
Banco, Redis, console de arquivos e painel continuam publicados apenas no próprio computador.
Não encaminhe essas portas no roteador para a internet. Esta configuração é para desenvolvimento/uso local.

## Comandos opcionais

```powershell
.\SAFEPOW.bat -Acao IniciarApi
.\SAFEPOW.bat -Acao IniciarPainel
.\SAFEPOW.bat -Acao Atualizar -Componente Api
.\SAFEPOW.bat -Acao Atualizar -Componente Painel
.\SAFEPOW.bat -Acao Parar -Componente Painel
.\SAFEPOW.bat -Acao Diagnosticar
```

Para gerar o APK, escolha **10** no menu. Ele detecta o Flutter, usa `mobile_app/env.local.json`
e salva o log em `SAFEPOW-logs/`. Não precisa de celular conectado nem da API ligada para compilar.
Se ainda não configurou o endereço, use **9** primeiro. Flutter e SDK Android precisam estar instalados.

Também pode executar na raiz:

```powershell
.\SAFEPOW.bat -Acao GerarApk
```

Comando manual equivalente, dentro de `mobile_app/`:

```powershell
flutter build apk --debug --dart-define-from-file=env.local.json
```

Este APK é de desenvolvimento. O resultado fica em `build/app/outputs/flutter-apk/app-debug.apk`.
O APK debug permite HTTP para o IP variável da rede local. Reinstale o APK após recompilar.
Antes de usar o app pelo Wi-Fi, inicie a API pela opção **7** e mantenha o Docker e o computador ligados.
Não é necessário iniciar o frontend para usar o app; ele fala diretamente com a API.

## Erros e backups

Use **3 — Diagnosticar**. Logs: `SAFEPOW-logs/`. Backups antes da preparação do banco: `SAFEPOW-backups/`.
O início da API interrompe a preparação se o backup falhar. O painel não executa migrations nem backups.
Nenhuma opção apaga volumes. As senhas do banco existente não mudam ao editar `.env`.
