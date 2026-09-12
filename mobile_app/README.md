# App Mobile — Sistema de Controle de Perdas de Estoque

Implementa a funcionalidade 1 do documento de arquitetura: registro de perdas
via leitura de código de barras ou digitação manual, com funcionamento
**offline-first** e sincronização automática (Seção 4 do documento).

## ✅ Status: compilado, rodado e testado ponta a ponta

Diferente do aviso que ficava aqui antes ("este código nunca foi compilado"),
o app já foi:
- Compilado (`flutter analyze` limpo) e rodado de verdade num emulador
  Android (API 34, `sdk_gphone64_x86_64`).
- Testado com o fluxo completo real: login → download do catálogo (produtos,
  motivos, locais) → registro de perda por código de barras digitado
  manualmente → gravação local instantânea (SQLite) → sincronização
  automática → conferido no banco Postgres do backend via API.

Dois bugs reais apareceram nesse teste (esperado — o código nunca tinha
rodado) e já foram corrigidos:
1. **`api_client.dart`**: duas arrow functions (`get`/`post`) usavam `await`
   sem serem `async` — erro de compilação, corrigido.
2. **Motivo/Local da perda eram texto livre no app, mas o backend exige
   `locationId`/`reasonId`** referenciando os catálogos cadastrados pelo
   gerente (Cadastros > Motivo/Local da Perda) — o mesmo padrão já usado
   para produtos. Isso não aparecia no `flutter analyze` (é um mismatch de
   contrato com a API, não um erro de sintaxe) — só foi descoberto ao testar
   o registro de uma perda de verdade e ver a sincronização falhar com erro
   do backend. Corrigido adicionando `LossReason`/`LossLocation` (modelo +
   repositório + cache local, no mesmo padrão de `Product`) e trocando o
   campo de texto livre por dois `DropdownButtonFormField` em
   `loss_form_screen.dart`.

Se você chegou aqui achando que precisava reescrever isso do zero: não
precisa — o que falta agora é só o que está listado em "O que ainda NÃO está
implementado" abaixo (background sync, testes, ícone/splash), não a lógica
principal do app.

## Passo a passo para rodar

1. Instale o Flutter SDK (https://docs.flutter.dev/get-started/install) e
   rode `flutter doctor` para confirmar que Android Studio/Xcode estão ok.

2. Dentro desta pasta (`mobile_app/`), gere a estrutura nativa
   Android/iOS — ela não vem incluída aqui de propósito, pois o próprio
   Flutter a gera de forma consistente com a versão do SDK instalada na sua
   máquina:
   ```bash
   flutter create . --project-name inventory_loss_app --org com.seusistema
   ```
   Isso cria as pastas `android/` e `ios/` sem sobrescrever o `lib/` e o
   `pubspec.yaml` que já estão prontos aqui.

3. Instale as dependências:
   ```bash
   flutter pub get
   ```

4. **Adicione as permissões nativas** (o `flutter create` não sabe que o app
   vai usar câmera):

   **Android** — em `android/app/src/main/AndroidManifest.xml`, dentro da tag `<manifest>`:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.CAMERA" />
   ```

   **iOS** — em `ios/Runner/Info.plist`, dentro do `<dict>` principal:
   ```xml
   <key>NSCameraUsageDescription</key>
   <string>Usado para escanear o código de barras dos produtos e fotografar perdas.</string>
   ```

5. Suba o backend (ver `../backend/README.md`) e ajuste a URL da API:
   - Emulador Android: o valor padrão `http://10.0.2.2:3000/api` já funciona.
   - Dispositivo físico: rode com
     `flutter run --dart-define=API_BASE_URL=http://SEU_IP_NA_REDE:3000/api`

6. Rode o app:
   ```bash
   flutter run
   ```

## Estrutura do projeto

```
lib/
  main.dart                        # ponto de entrada
  app.dart                         # MaterialApp + verificação de sessão salva
  app_services.dart                # localizador simples de repositórios/serviços
  core/
    config/app_config.dart         # URL da API, intervalos de sincronização
    network/api_client.dart        # cliente HTTP central (token, erros, bloqueio 402)
    storage/app_database.dart      # SQLite local (cache de produtos + fila de perdas)
    storage/secure_session_storage.dart  # token JWT em Keystore/Keychain
    sync/sync_queue_service.dart   # motor da sincronização offline (Seção 4)
  data/
    models/                        # Product, Loss, LossReason, LossLocation, AuthSession
    repositories/                  # Auth, Product, LossReason, LossLocation, Loss
  presentation/
    screens/
      login_screen.dart
      home_screen.dart
      scan_screen.dart             # câmera + digitação manual do código de barras
      loss_form_screen.dart        # formulário de registro da perda
      pending_sync_screen.dart     # acompanhamento da fila de sincronização
      subscription_blocked_screen.dart  # tela de bloqueio (Seção 6.2)
```

## Decisões implementadas (e onde estão)

| Decisão do documento | Onde está no código |
|---|---|
| Registro local instantâneo, sem depender de rede (Seção 4.1) | `LossRepository.registerLossLocally` |
| Idempotência via `clientGeneratedId` (Seção 4.2) | `data/models/loss.dart` + `LossesService.create` no backend |
| Reenvio com backoff progressivo (Seção 4.2) | `SyncQueueService._backoffFor` |
| Sincronização de catálogo para uso offline (Seção 4.3) | `ProductRepository.refreshFromServer` / `findByBarcodeLocal` |
| Indicação visual de pendências para o funcionário | `PendingSyncScreen`, badge na `HomeScreen` |
| Bloqueio remoto por inadimplência (Seção 6.2) | `SubscriptionInactiveException` (api_client) → `SubscriptionBlockedScreen` |

## O que ainda NÃO está implementado

- **Sincronização em segundo plano de verdade** (app fechado) — hoje o
  `SyncQueueService` só roda com o app aberto (conectividade + timer). Para
  produção, integrar `workmanager` (Android) e `BGTaskScheduler` (iOS),
  ambos exigindo configuração nativa específica de cada plataforma que não
  dá para validar sem compilar em um Mac/Android real.
- **Testes automatizados** (unitários do `SyncQueueService`/repositórios e
  testes de widget das telas).
- **Ícone do app, splash screen e nome final do pacote** (`com.seusistema.*`)
  — ajuste no `flutter create` do passo 2 e nos assets nativos gerados.

## O que foi implementado nesta rodada (upload de foto + sincronização incremental)

- **Upload de foto real**: `ApiClient.postMultipartFile` sobe a imagem para
  `POST /uploads/loss-image` (multipart) antes de enviar o registro da perda;
  a URL retornada fica salva localmente (`uploadedImageUrl`) para nunca
  reenviar a mesma foto duas vezes, mesmo que o registro da perda em si
  precise de várias tentativas.
- **Sincronização incremental de catálogo**: da segunda chamada em diante,
  `ProductRepository.refreshFromServer()` usa `GET /products?since=<data da
  última sincronização>` em vez de baixar a lista inteira — a data fica
  guardada numa tabela local simples de metadados (`sync_metadata`).

## Testando o fluxo offline manualmente

1. Faça login com o app conectado à internet (isso baixa o catálogo de produtos).
2. Ative o modo avião.
3. Escaneie um produto (ou digite o código manualmente) e registre uma perda —
   deve salvar instantaneamente e aparecer como "Aguardando envio" na tela de registros.
4. Desative o modo avião — em até 30 segundos (ou imediatamente, pela
   detecção de conectividade) o registro deve mudar para "Sincronizado".
