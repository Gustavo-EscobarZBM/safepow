# Instalar e usar o SAFEPOW

**Abra somente `SAFEPOW.bat`.** Ele reúne instalação, atualização, configuração e geração do APK.
Os arquivos de `scripts/` são internos ao menu; mantenha a pasta junto do projeto.

## Primeira instalação

1. Abra `SAFEPOW.bat` e escolha **6 — Requisitos**.
2. Escolha **1 — Iniciar API + painel** e aguarde terminar.
3. Abra o painel em **http://localhost:3001**.

O menu tenta instalar Docker Desktop se faltar. Autorize os pedidos do Windows e reinicie se solicitado.
Node.js, banco, Redis e armazenamento são executados pelo Docker.

## Usar no celular pelo Wi-Fi

1. Conecte celular e computador à mesma rede.
2. Escolha **9 — Configurar conexão → Wi-Fi**. Autorize o firewall; a rede deve ser privada e de confiança.
3. Escolha **7 — Iniciar somente API**.
4. Escolha **10 — Gerar APK**, transfira o arquivo mostrado ao celular e abra para instalar.
   Se preferir instalar pelo cabo, conecte e autorize o Android e escolha **4 — Abrir app Android**.

Para gerar o APK, é necessário ter Flutter e SDK Android instalados; não precisa conectar celular.
O arquivo fica em `mobile_app/build/app/outputs/flutter-apk/app-debug.apk` e é uma versão de desenvolvimento.
Se o IP do computador mudar, repita a configuração e gere/instale o APK novamente.

**Para fazer login e sincronizar, mantenha o computador e o Docker ligados, com a API iniciada.**
O app não depende do painel. Após instalar, pode usar Wi-Fi sem cabo.

## Menu do dia a dia

| Opção | Ação |
|---|---|
| 1 | Iniciar API e painel; instalar na primeira vez |
| 2 | Atualizar API, painel ou ambos com o código local |
| 3 | Diagnosticar problemas |
| 4 | Instalar/abrir app no Android conectado |
| 5 | Parar o componente escolhido |
| 6 | Conferir requisitos da máquina |
| 7 | Iniciar somente API |
| 8 | Iniciar somente painel |
| 9 | Configurar Wi-Fi ou USB |
| 10 | Gerar APK sem conectar celular |
| 0 | Sair do menu, mantendo os serviços ligados |

## Arquivos que você precisa conhecer

- `SAFEPOW.bat`: entrada única para todas as operações.
- `INSTALACAO.md`: este guia.
- `SAFEPOW-logs/`: mensagens para investigar erros.
- `SAFEPOW-backups/`: cópias do banco; guarde esses arquivos.

Mantenha `backend/`, `web-panel/`, `mobile_app/` e `scripts/`: o menu usa essas pastas.
Não apague arquivos `.env` nem volumes Docker para reinstalar; eles contêm configuração e dados.

Configuração manual, credenciais iniciais, USB e detalhes técnicos: [guia avançado](docs/INSTALACAO-AVANCADA.md).
