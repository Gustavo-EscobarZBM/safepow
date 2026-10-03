# Entrada unica do projeto. Cada acao roda em processo separado para que uma falha nao feche o menu.
param(
    [ValidateSet('Menu', 'Iniciar', 'Atualizar', 'Diagnosticar', 'App', 'Parar', 'Requisitos', 'IniciarApi', 'IniciarPainel', 'ConfigurarRede', 'GerarApk')]
    [string]$Acao = 'Menu',
    [ValidateSet('Todos', 'Api', 'Painel', 'App')][string]$Componente = 'Todos',
    [switch]$SemNavegador
)
$ErrorActionPreference = 'Stop'

function Show-SafepowRequirements {
    # Apenas procura executaveis: nao instala ferramentas, inicia servicos ou executa SDKs.
    function Find-Tool([string]$Command, [string[]]$Paths = @()) {
        $found = Get-Command $Command -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.Source }
        return $Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf -ErrorAction SilentlyContinue) } | Select-Object -First 1
    }
    function Show-Tool([string]$Name, [string]$Path, [string]$HelpText) {
        if ($Path) { Write-Host "[ENCONTRADO] $Name - $Path" -ForegroundColor Green }
        else { Write-Host "[NAO LOCALIZADO] $Name" -ForegroundColor Yellow }
        Write-Host "  $HelpText"
    }
    $root = Split-Path -Parent $PSScriptRoot
    $properties = @{}
    $propsPath = Join-Path $root 'mobile_app\android\local.properties'
    if (Test-Path -LiteralPath $propsPath) {
        foreach ($line in Get-Content -LiteralPath $propsPath) {
            if ($line -match '^\s*(flutter\.sdk|sdk\.dir)\s*=\s*(.*?)\s*$') {
                $properties[$matches[1]] = $matches[2].Replace('\\', '\').Replace('\:', ':').Replace('\ ', ' ')
            }
        }
    }
    $savedFlutter = $null
    $configPath = Join-Path $root 'SAFEPOW-logs\flutter.config.json'
    if (Test-Path -LiteralPath $configPath) {
        try { $savedFlutter = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).flutterPath }
        catch { Write-Host 'O caminho salvo do Flutter nao pode ser lido; buscando nos locais comuns.' -ForegroundColor Yellow }
    }

    Write-Host "`n========== REQUISITOS DA MAQUINA ==========" -ForegroundColor Cyan
    Write-Host 'PARA API E PAINEL'
    Write-Host '- Windows compativel com Docker Desktop e navegador atualizado.'
    Write-Host '- Docker com containers Linux; WSL 2 ou backend Hyper-V configurado.'
    Write-Host '- Virtualizacao habilitada na BIOS/UEFI e recursos suficientes para o Docker.'
    Write-Host '- Internet na primeira instalacao e ao baixar atualizacoes/dependencias.'
    Show-Tool 'Docker Desktop' (Find-Tool 'Docker Desktop.exe' @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
    )) 'Necessario no fluxo automatico. A opcao 1 tenta instalar se o comando docker estiver ausente.'
    Show-Tool 'Comando Docker' (Find-Tool 'docker.exe' @(
        "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe"
    )) 'O Docker Desktop inclui o Compose. Para conferir os servicos, use a opcao 3 - Diagnosticar.'
    Show-Tool 'WSL (comando)' (Find-Tool 'wsl.exe') 'Encontrar wsl.exe nao confirma WSL 2 configurado. Confira a configuracao no Docker Desktop.'
    Show-Tool 'Winget (opcional)' (Find-Tool 'winget.exe') 'Usado para instalar Docker automaticamente. Sem ele, instale Docker Desktop manualmente.'
    Write-Host 'Guia oficial do Docker: https://docs.docker.com/desktop/setup/install/windows-install/'
    Write-Host "`nNode.js, npm, PostgreSQL, Redis e armazenamento ficam nos containers."
    Write-Host 'Nao e preciso instalar essas ferramentas separadamente no Windows para API/painel.'
    Write-Host 'Git so e necessario se voce quiser baixar/atualizar o codigo usando Git.'

    Write-Host "`nSOMENTE PARA O APP ANDROID (opcao 4)" -ForegroundColor Cyan
    $flutterPaths = @($savedFlutter, 'C:\flutter\bin\flutter.bat', 'C:\src\flutter\bin\flutter.bat',
        'C:\dev\flutter\bin\flutter.bat', 'C:\tools\flutter\bin\flutter.bat',
        "$env:FLUTTER_ROOT\bin\flutter.bat", "$env:FLUTTER_HOME\bin\flutter.bat",
        "$env:USERPROFILE\flutter\bin\flutter.bat", "$env:LOCALAPPDATA\flutter\bin\flutter.bat",
        (Join-Path $root '.fvm\flutter_sdk\bin\flutter.bat'),
        (Join-Path $root 'mobile_app\.fvm\flutter_sdk\bin\flutter.bat'))
    if ($properties['flutter.sdk']) { $flutterPaths += Join-Path $properties['flutter.sdk'] 'bin\flutter.bat' }
    Show-Tool 'Flutter SDK' (Find-Tool 'flutter.bat' $flutterPaths) 'Necessario para compilar/abrir o app pelo codigo; nao e instalado automaticamente.'
    $sdkPaths = @($properties['sdk.dir'], $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
        'C:\android-sdk', "$env:LOCALAPPDATA\Android\Sdk") | Where-Object { $_ }
    $adbPaths = @($sdkPaths | ForEach-Object { Join-Path $_ 'platform-tools\adb.exe' })
    Show-Tool 'Android SDK (ADB)' (Find-Tool 'adb.exe' $adbPaths) 'Configure SDK, JDK e licencas Android. O Android Studio ajuda nessa preparacao.'
    Write-Host '- Um emulador configurado OU celular USB com depuracao autorizada.'
    Write-Host '- Confira a configuracao completa do app com flutter doctor.'
    Write-Host "`nEsta consulta detecta arquivos no PATH e em locais comuns; nao valida versoes,"
    Write-Host 'WSL 2, virtualizacao, licencas, conectividade ou a configuracao completa dos SDKs.'
    Write-Host 'Uma ferramenta em outro local pode estar instalada mesmo sem ser localizada aqui.'
    Write-Host 'Para comecar apenas com API/painel, volte ao menu e escolha 1 - Iniciar.'
}

function Invoke-SafepowAction([string]$Action) {
    if ($Action -eq 'Requisitos') {
        Show-SafepowRequirements
        $script:actionExitCode = 0
        return
    }
    $files = @{
        Iniciar = 'Iniciar-SAFEPOW.ps1'
        Atualizar = 'Iniciar-SAFEPOW.ps1'
        Diagnosticar = 'Diagnosticar-SAFEPOW.ps1'
        App = 'Iniciar-App-SAFEPOW.ps1'
        Parar = 'Parar-SAFEPOW.ps1'
        IniciarApi = 'Iniciar-SAFEPOW.ps1'
        IniciarPainel = 'Iniciar-SAFEPOW.ps1'
        ConfigurarRede = 'Configurar-Rede-SAFEPOW.ps1'
        GerarApk = 'Iniciar-App-SAFEPOW.ps1'
    }
    $file = Join-Path $PSScriptRoot $files[$Action]
    if (-not (Test-Path -LiteralPath $file)) { throw "Arquivo ausente: $file. Extraia a pasta completa do projeto." }
    $arguments = @('-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $file, '-SemPausa')
    if ($Action -eq 'Atualizar') { $arguments += '-Atualizar' }
    if ($Action -eq 'GerarApk') { $arguments += '-GerarApk' }
    if ($Action -in @('Iniciar', 'Atualizar', 'Parar')) { $arguments += @('-Componente', $Componente) }
    if ($Action -eq 'IniciarApi') { $arguments += @('-Componente', 'Api') }
    if ($Action -eq 'IniciarPainel') { $arguments += @('-Componente', 'Painel') }
    if ($SemNavegador -and $Action -in @('Iniciar', 'Atualizar', 'IniciarApi', 'IniciarPainel')) { $arguments += '-SemNavegador' }
    & powershell.exe @arguments
    $script:actionExitCode = $LASTEXITCODE
    if ($script:actionExitCode -ne 0) {
        Write-Host "`nA operacao nao foi concluida. Confira a mensagem acima; a opcao Diagnosticar pode ajudar." -ForegroundColor Yellow
    }
}

try {
    if ($Acao -ne 'Menu') {
        Invoke-SafepowAction $Acao
        exit $script:actionExitCode
    }
    while ($true) {
        Write-Host "`n========== SAFEPOW ==========" -ForegroundColor Cyan
        Write-Host '1 - Iniciar API + painel (instala na primeira vez)'
        Write-Host '2 - Atualizar API, painel ou ambos'
        Write-Host '3 - Diagnosticar problemas'
        Write-Host '4 - Abrir app Android (opcional)'
        Write-Host '5 - Parar API, painel, app ou tudo'
        Write-Host '6 - Requisitos da maquina (o que precisa estar instalado)'
        Write-Host '7 - Iniciar somente API'
        Write-Host '8 - Iniciar somente painel'
        Write-Host '9 - Configurar conexao do celular (Wi-Fi ou USB)'
        Write-Host '10 - Gerar APK (sem conectar celular)'
        Write-Host '0 - Sair do menu (mantem o sistema ligado)'
        $choice = Read-Host 'Escolha uma opcao [Enter = Iniciar]'
        $action = switch ($choice) {
            '' { 'Iniciar' }
            '1' { 'Iniciar' }
            '2' { 'Atualizar' }
            '3' { 'Diagnosticar' }
            '4' { 'App' }
            '5' { 'Parar' }
            '6' { 'Requisitos' }
            '7' { 'IniciarApi' }
            '8' { 'IniciarPainel' }
            '9' { 'ConfigurarRede' }
            '10' { 'GerarApk' }
            '0' { exit 0 }
            default { $null }
        }
        if (-not $action) { Write-Host 'Opcao invalida.'; continue }
        $Componente = 'Todos'
        if ($action -in @('Atualizar', 'Parar')) {
            Write-Host '1 - API | 2 - Painel | 3 - Todos'
            if ($action -eq 'Parar') { Write-Host '4 - Apenas o app Android' }
            $target = Read-Host 'Escolha o componente [Enter = Todos; 0 = Voltar]'
            if ($target -eq '0') { continue }
            $selectedComponent = switch ($target) {
                '1' { 'Api' }; '2' { 'Painel' }; '3' { 'Todos' }; '' { 'Todos' }
                '4' { if ($action -eq 'Parar') { 'App' } }
            }
            if (-not $selectedComponent) { Write-Host 'Opcao invalida.'; continue }
            $Componente = $selectedComponent
        }
        Invoke-SafepowAction $action
        Read-Host 'Pressione Enter para voltar ao menu' | Out-Null
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
