# Windows PowerShell 5.1. Coloque junto das pastas backend, web-panel e mobile_app.
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
    $root = $PSScriptRoot
    $logDir = Join-Path $root 'SAFEPOW-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    foreach ($part in @('backend', 'web-panel', 'mobile_app')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $part) -PathType Container)) {
            throw 'Extraia os arquivos na pasta safepow, junto das pastas backend, web-panel e mobile_app.'
        }
    }
    # Inclui alteracoes recentes do PATH sem exigir reiniciar o Explorer.
    $env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    foreach ($tool in @('docker', 'npm.cmd')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool nao encontrado no PATH. Use o mesmo ambiente em que os comandos ja funcionam." }
    }
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
    $configPath = Join-Path $root 'SAFEPOW-iniciador.config.json'
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
    Write-Host '1/4 - Iniciando Docker...' -ForegroundColor Cyan
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        $dockerApp = @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe", "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $dockerApp) { throw 'Docker Desktop nao localizado. Abra-o manualmente e execute este iniciador novamente.' }
        Start-Process -FilePath $dockerApp
        Wait-Until { & docker info *> $null; $LASTEXITCODE -eq 0 } 240 'Docker nao ficou pronto em 4 minutos. Confira a janela do Docker Desktop.'
    }
    Write-Host '2/4 - Iniciando backend...' -ForegroundColor Cyan
    Push-Location -LiteralPath (Join-Path $root 'backend')
    try {
        # --build: remonta o backend com o codigo atual (sem isso o container roda a imagem antiga).
        & docker compose up -d --build
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar os containers. Confira o erro acima.' }
    } finally { Pop-Location }
    Wait-Until { Http-Ready 'http://localhost:3000/api' $true } 180 'API nao respondeu na porta 3000. Confira os logs do backend no Docker Desktop.'
    Write-Host '3/4 - Iniciando painel web...' -ForegroundColor Cyan
    if (-not (Http-Ready 'http://localhost:3001')) {
        $listener = @(Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue)
        if ($listener.Count -gt 0) {
            Write-Host 'Porta 3001 ocupada; aguardando o painel existente responder...'
        } else {
            $webProcess = Start-BackgroundService 'painel' (Join-Path $root 'web-panel') '& npm.cmd run dev'
        }
        Wait-Until { Http-Ready 'http://localhost:3001' } 180 'Painel nao respondeu em http://localhost:3001. Confira SAFEPOW-logs\painel.log e se a porta esta ocupada por outro programa.'
    }
    Start-Process 'http://localhost:3001'
    Write-Host '4/4 - Preparando Android...' -ForegroundColor Cyan
    $adb = if ($sdk) { Join-Path $sdk 'platform-tools\adb.exe' } else { (Get-Command adb.exe -ErrorAction SilentlyContinue).Source }
    if (-not $adb) { throw 'ADB nao encontrado. Defina ANDROID_HOME com a pasta do SDK Android ou adicione platform-tools ao PATH.' }
    & $adb start-server
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel iniciar o ADB.' }
    function Get-AndroidDevices {
        @(& $adb devices) | ForEach-Object { if ($_ -match '^(\S+)\s+device\s*$') { $matches[1] } }
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
    # Encaminha apenas a porta da API para o computador, inclusive em celular USB.
    & $adb -s $device reverse tcp:3000 tcp:3000
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel encaminhar a porta 3000 pelo ADB. Confira a conexao com o Android.' }
    $flutterCommand = '& ' + (Quote-PS $flutter) + ' run -d ' + (Quote-PS $device) + ' --dart-define=API_BASE_URL=http://127.0.0.1:3000/api'
    $mobileProcess = Start-BackgroundService 'mobile' (Join-Path $root 'mobile_app') $flutterCommand
    Write-Host 'Android iniciado. O aplicativo continuara iniciando em segundo plano.' -ForegroundColor Green
} catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Se algum componente iniciou nesta tentativa, ele continua ativo. Copie o erro ou tire um print para diagnostico.'
    Read-Host 'Pressione Enter para fechar'
    exit 1
}
exit 0
