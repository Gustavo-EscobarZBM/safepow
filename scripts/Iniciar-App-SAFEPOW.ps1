# Android opcional: execute depois de SAFEPOW.bat (opcao Iniciar).
param([switch]$SemPausa, [switch]$GerarApk)
$ErrorActionPreference = 'Stop'
function Wait-Until([scriptblock]$Check, [int]$Seconds, [string]$Message) {
    $end = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Check) { return }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $end)
    throw $Message
}
function Choose-One($Items, [string]$Title) {
    $Items = @($Items)
    if ($Items.Count -eq 0) { throw "Nenhuma opcao encontrada: $Title" }
    if ($Items.Count -eq 1) { return $Items[0] }
    Write-Host "`n$Title"
    for ($i = 0; $i -lt $Items.Count; $i++) { Write-Host "$($i+1). $($Items[$i])" }
    do { $n = 0; $ok = [int]::TryParse((Read-Host 'Digite o numero'), [ref]$n) } until ($ok -and $n -ge 1 -and $n -le $Items.Count)
    return $Items[$n-1]
}
function Quote-PS([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
function Start-BackgroundService([string]$Name, [string]$Folder, [string]$Command) {
    $log = Join-Path $logDir ($Name + '.log')
    $state = Join-Path $logDir ($Name + '.process.json')
    if (Test-Path -LiteralPath $state) {
        $previous = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
        $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$previous.pid)" -ErrorAction SilentlyContinue
        if ($existing -and $existing.CommandLine -like ('*' + $previous.token + '*')) {
            $previousCode = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($previous.token))
            if (-not $previousCode.Contains($Command)) {
                throw 'Ja existe um app iniciado com outra configuracao. Escolha 5 > Apenas app Android e depois 4 novamente.'
            }
            return (Get-Process -Id $previous.pid)
        }
    }
    if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log }
    $code = 'Set-Location -LiteralPath ' + (Quote-PS $Folder) + '; & { ' + $Command + ' } *> ' + (Quote-PS $log) + '; exit $LASTEXITCODE'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $proc = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded)
    @{ pid = $proc.Id; token = $encoded } | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8
    return $proc
}
function Wait-MobileLaunch([System.Diagnostics.Process]$Process, [string]$LogPath) {
    Write-Host 'Compilando e instalando o app. Na primeira vez os downloads podem demorar.' -ForegroundColor Cyan
    Write-Host 'Mantenha o celular conectado e desbloqueado. Autorize a instalacao se ele solicitar.'
    $deadline = (Get-Date).AddMinutes(20)
    $seen = 0
    $lastNotice = Get-Date
    do {
        $lines = @(Get-Content -LiteralPath $LogPath -ErrorAction SilentlyContinue)
        if ($lines.Count -lt $seen) { $seen = 0 }
        for ($i = $seen; $i -lt $lines.Count; $i++) { Write-Host $lines[$i] }
        $seen = $lines.Count
        $Process.Refresh()
        if ($Process.HasExited) { throw "A inicializacao do app terminou antes da confirmacao. Confira o erro acima ou $LogPath." }
        if (($lines -join "`n") -match 'A Dart VM Service on .+ is available at:') {
            Write-Host 'App iniciado no Android. O menu pode ser usado novamente.' -ForegroundColor Green
            return
        }
        if (((Get-Date) - $lastNotice).TotalSeconds -ge 30) {
            Write-Host 'Ainda aguardando compilacao/instalacao... (o app ainda nao foi confirmado no celular)' -ForegroundColor Yellow
            $lastNotice = Get-Date
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "O app ainda nao confirmou a inicializacao apos 20 minutos. O processo continua em segundo plano; acompanhe $LogPath e confira sua conexao."
}
function Http-Ready([string]$Url, [bool]$AllowClientError = $false) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
    } catch {
        if ($AllowClientError -and $_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
            return ($code -ge 400 -and $code -lt 500)
        }
        return $false
    }
}
try {
    $root = Split-Path -Parent $PSScriptRoot
    $logDir = Join-Path $root 'SAFEPOW-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    foreach ($part in @('mobile_app')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $part) -PathType Container)) {
            throw 'Extraia os arquivos na pasta safepow, junto das pastas backend, web-panel e mobile_app.'
        }
    }
    # Inclui alteracoes recentes do PATH sem exigir reiniciar o Explorer.
    $env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    # Usa os SDKs que o proprio projeto utilizou na compilacao anterior.
    $localProps = @{}
    $propsPath = Join-Path $root 'mobile_app\android\local.properties'
    if (Test-Path -LiteralPath $propsPath) {
        foreach ($line in (Get-Content -LiteralPath $propsPath)) {
            if ($line -match '^\s*(flutter\.sdk|sdk\.dir)\s*=\s*(.*?)\s*$') {
                $key = $matches[1]
                $value = $matches[2].Replace('\\', '\').Replace('\:', ':').Replace('\ ', ' ')
                $localProps[$key] = $value
            }
        }
    }
    $sdk = @($localProps['sdk.dir'], 'C:\android-sdk', $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk") | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platform-tools\adb.exe')) } | Select-Object -First 1
    if ($sdk) {
        $env:ANDROID_HOME = $sdk
        $env:ANDROID_SDK_ROOT = $sdk
        $env:Path = (Join-Path $sdk 'platform-tools') + ';' + (Join-Path $sdk 'emulator') + ';' + $env:Path
        Write-Host "SDK Android localizado: $sdk"
    }
    $flutter = $null
    if ($localProps['flutter.sdk']) {
        $fromProject = Join-Path $localProps['flutter.sdk'] 'bin\flutter.bat'
        if (Test-Path -LiteralPath $fromProject -PathType Leaf) { $flutter = $fromProject }
    }
    $configPath = Join-Path $logDir 'flutter.config.json'
    if (-not $flutter -and (Test-Path -LiteralPath $configPath)) {
        try {
            $saved = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).flutterPath
            if ($saved -and (Test-Path -LiteralPath $saved -PathType Leaf) -and ([IO.Path]::GetFileName($saved) -ieq 'flutter.bat')) { $flutter = $saved }
        } catch { Write-Host 'Configuracao anterior invalida; procurando Flutter novamente.' }
    }
    if (-not $flutter) {
        $cmd = Get-Command flutter.bat -ErrorAction SilentlyContinue
        if ($cmd) { $flutter = $cmd.Source }
    }
    if (-not $flutter) {
        $candidates = @(
            (Join-Path $root '.fvm\flutter_sdk\bin\flutter.bat'),
            (Join-Path $root 'mobile_app\.fvm\flutter_sdk\bin\flutter.bat'),
            "$env:FLUTTER_ROOT\bin\flutter.bat",
            "$env:FLUTTER_HOME\bin\flutter.bat",
            'C:\flutter\bin\flutter.bat',
            'C:\src\flutter\bin\flutter.bat',
            'C:\dev\flutter\bin\flutter.bat',
            'C:\development\flutter\bin\flutter.bat',
            'C:\tools\flutter\bin\flutter.bat',
            "$env:USERPROFILE\flutter\bin\flutter.bat",
            "$env:USERPROFILE\develop\flutter\bin\flutter.bat",
            "$env:USERPROFILE\development\flutter\bin\flutter.bat",
            "$env:USERPROFILE\dev\flutter\bin\flutter.bat",
            "$env:USERPROFILE\Documents\flutter\bin\flutter.bat",
            "$env:USERPROFILE\Downloads\flutter\bin\flutter.bat",
            "$env:LOCALAPPDATA\flutter\bin\flutter.bat"
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique
        if (@($candidates).Count -gt 0) { $flutter = Choose-One $candidates 'Qual instalacao Flutter deseja usar?' }
    }
    if (-not $flutter) {
        Write-Host 'Flutter nao localizado automaticamente. Selecione flutter.bat dentro da pasta flutter\bin.' -ForegroundColor Yellow
        try {
            Add-Type -AssemblyName System.Windows.Forms
            $dialog = New-Object System.Windows.Forms.OpenFileDialog
            $dialog.Title = 'Selecione flutter.bat dentro da pasta do Flutter > bin'
            $dialog.Filter = 'Flutter (flutter.bat)|flutter.bat'
            $dialog.InitialDirectory = $env:USERPROFILE
            if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $flutter = $dialog.FileName }
            $dialog.Dispose()
        } catch { Write-Host 'Nao foi possivel abrir o seletor de arquivos.' }
        if (-not $flutter) { $flutter = (Read-Host 'Cole o caminho completo de flutter.bat (ou Enter para cancelar)').Trim().Trim('"') }
    }
    if (-not $flutter -or -not (Test-Path -LiteralPath $flutter -PathType Leaf) -or ([IO.Path]::GetFileName($flutter) -ine 'flutter.bat')) {
        throw 'Flutter nao selecionado. Localize a pasta do SDK Flutter e execute novamente.'
    }
    $flutter = (Resolve-Path -LiteralPath $flutter).Path
    $env:Path = (Split-Path -Parent $flutter) + ';' + $env:Path
    try {
        @{ flutterPath = $flutter } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
    } catch { Write-Host 'Nao foi possivel salvar a escolha. Ela vale apenas para esta execucao.' }
    Write-Host "Flutter localizado: $flutter"
    $appEnvPath = Join-Path $root 'mobile_app\env.local.json'
    if (-not (Test-Path -LiteralPath $appEnvPath)) { throw 'Configure a conexao do app na opcao 9 do menu (Wi-Fi ou USB).' }
    $appEnv = Get-Content -LiteralPath $appEnvPath -Raw | ConvertFrom-Json
    $apiUri = $null
    if (-not [Uri]::TryCreate($appEnv.API_BASE_URL, [UriKind]::Absolute, [ref]$apiUri) -or $apiUri.Scheme -notin @('http', 'https') -or $apiUri.UserInfo) { throw 'API_BASE_URL invalida em mobile_app\env.local.json.' }
    $mode = $appEnv.CONNECTION_MODE
    if ($mode -notin @('wifi', 'usb')) { throw 'CONNECTION_MODE deve ser wifi ou usb em mobile_app\env.local.json.' }
    $apiBase = $appEnv.API_BASE_URL.TrimEnd('/')
    $apiPort = $apiUri.Port
    $storagePort = if ($appEnv.STORAGE_PORT) { [int]$appEnv.STORAGE_PORT } else { 9000 }
    if ($mode -eq 'usb' -and -not $apiUri.IsLoopback) { throw 'No modo USB use 127.0.0.1 ou localhost como endereco da API.' }
    if ($GerarApk) {
        Write-Host "Gerando APK de desenvolvimento | API: $apiBase" -ForegroundColor Cyan
        Write-Host 'Nao precisa conectar celular nem iniciar Docker/API para compilar.'
        if ($mode -eq 'usb') {
            Write-Host 'Configuracao USB: este APK exige encaminhamento por cabo para acessar a API. Para Wi-Fi, use a opcao 9 antes de gerar.' -ForegroundColor Yellow
        }
        $apkLog = Join-Path $logDir ('apk-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
        $apkTranscript = $false
        Push-Location (Join-Path $root 'mobile_app')
        try {
            Start-Transcript -Path $apkLog | Out-Null
            $apkTranscript = $true
            & $flutter build apk --debug "--dart-define-from-file=$appEnvPath"
            if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar APK. Consulte $apkLog" }
            $apkPath = Join-Path $root 'mobile_app\build\app\outputs\flutter-apk\app-debug.apk'
            if (-not (Test-Path -LiteralPath $apkPath -PathType Leaf)) { throw 'Flutter terminou sem gerar o APK esperado.' }
            Write-Host "`nAPK gerado: $apkPath" -ForegroundColor Green
            Write-Host 'Transfira este arquivo ao Android e abra para instalar/atualizar o SAFEPOW.'
            Write-Host "API configurada: $apiBase | Log: $apkLog"
        } finally {
            if ($apkTranscript) { Stop-Transcript | Out-Null }
            Pop-Location
        }
        if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' | Out-Null }
        exit 0
    }
    if (-not (Http-Ready "$apiBase/health")) { throw "API indisponivel em $apiBase. Inicie a API (opcao 7) e confira a configuracao de rede (opcao 9)." }
    Write-Host "Conexao do app: $mode | API: $apiBase"
    Write-Host 'Preparando Android...' -ForegroundColor Cyan
    $adb = if ($sdk) { Join-Path $sdk 'platform-tools\adb.exe' } else { (Get-Command adb.exe -ErrorAction SilentlyContinue).Source }
    if (-not $adb) { throw 'ADB nao encontrado. Defina ANDROID_HOME com a pasta do SDK Android ou adicione platform-tools ao PATH.' }
    & $adb start-server
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel iniciar o ADB.' }
    function Get-AndroidDevices {
        $deviceLines = @(& $adb devices)
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar dispositivos Android pelo ADB.' }
        $authorized = @($deviceLines | ForEach-Object { if ($_ -match '^(\S+)\s+device\s*$') { $matches[1] } })
        if ($authorized.Count -gt 0) { return $authorized }
        if ($deviceLines -match '\s+unauthorized\s*$') {
            throw 'Celular conectado mas nao autorizado. Desbloqueie a tela, aceite Permitir depuracao USB e escolha a opcao 4 novamente.'
        }
        if ($deviceLines -match '\s+offline\s*$') {
            throw 'Android aparece offline. Reconecte o cabo USB, desbloqueie o celular e tente novamente.'
        }
    }
    $devices = @(Get-AndroidDevices)
    if ($devices.Count -eq 0) {
        $emulator = if ($sdk) { Join-Path $sdk 'emulator\emulator.exe' } else { (Get-Command emulator.exe -ErrorAction SilentlyContinue).Source }
        if (-not $emulator -or -not (Test-Path -LiteralPath $emulator)) { throw 'Conecte e autorize um Android por USB, ou configure um emulador no Android Studio.' }
        $avds = @(& $emulator -list-avds | Where-Object { $_.Trim() })
        $avd = Choose-One $avds 'Qual emulador deseja abrir?'
        $emuStart = New-Object System.Diagnostics.ProcessStartInfo
        $emuStart.FileName = $emulator
        $emuStart.Arguments = '-avd "' + $avd + '"'
        $emuStart.UseShellExecute = $false
        $emuStart.CreateNoWindow = $true
        [System.Diagnostics.Process]::Start($emuStart) | Out-Null
        Wait-Until { @(Get-AndroidDevices).Count -gt 0 } 240 'Android nao conectado. Confira o emulador ou autorize a depuracao USB no celular.'
        $devices = @(Get-AndroidDevices)
    }
    $device = Choose-One $devices 'Qual Android deseja usar?'
    Write-Host "Aguardando Android iniciar: $device"
    Wait-Until { ((& $adb -s $device shell getprop sys.boot_completed 2>$null) -join '').Trim() -eq '1' } 240 'Android nao terminou de iniciar. Confira o dispositivo e tente novamente.'
    if ($mode -eq 'usb') {
        & $adb -s $device reverse "tcp:$apiPort" "tcp:$apiPort"
        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel encaminhar a porta da API pelo ADB.' }
        & $adb -s $device reverse "tcp:$storagePort" "tcp:$storagePort"
        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel encaminhar a porta das imagens pelo ADB.' }
    } else {
        Write-Host 'O USB e usado para instalar/depurar. A comunicacao com a API usa a rede Wi-Fi.'
    }
    $flutterCommand = '& ' + (Quote-PS $flutter) + ' run -d ' + (Quote-PS $device) + ' ' + (Quote-PS ('--dart-define=API_BASE_URL=' + $apiBase))
    $mobileProcess = Start-BackgroundService 'mobile' (Join-Path $root 'mobile_app') $flutterCommand
    Wait-MobileLaunch $mobileProcess (Join-Path $logDir 'mobile.log')
} catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Se algum componente iniciou nesta tentativa, ele continua ativo. Copie o erro ou tire um print para diagnostico.'
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
    exit 1
}
exit 0
