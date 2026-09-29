# Windows PowerShell 5.1. Instalacao de PRIMEIRA VEZ do SAFEPOW num computador novo.
# Pre-requisitos ja instalados (ver INSTALACAO.md): Git, Node.js 24, Docker Desktop, Flutter em C:\flutter,
# Android Studio com SDK e um emulador. Depois deste script, o dia a dia e o "INICIAR PROJETO.bat".
# -SemPausa: para rodar sem janela interativa (ex.: pelo Claude Code); nao espera 'Pressione Enter'.
param([switch]$SemPausa)
$ErrorActionPreference = 'Stop'
function Pause-End { if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' | Out-Null } }

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Run([string]$Folder, [scriptblock]$Command, [string]$Failure) {
    Push-Location -LiteralPath $Folder
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) { throw $Failure }
    } finally { Pop-Location }
}
function Wait-Until([scriptblock]$Check, [int]$Seconds, [string]$Message) {
    $end = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Check) { return }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $end)
    throw $Message
}

try {
    $root = $PSScriptRoot
    $backend = Join-Path $root 'backend'
    $web = Join-Path $root 'web-panel'
    $mobile = Join-Path $root 'mobile_app'
    $env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')

    Step '1/6 - Conferindo ferramentas'
    foreach ($tool in @('git', 'node', 'npm.cmd', 'docker')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool nao encontrado. Instale conforme INSTALACAO.md e abra um novo terminal." }
    }
    $flutter = @((Get-Command flutter.bat -ErrorAction SilentlyContinue).Source, 'C:\flutter\bin\flutter.bat') |
        Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $flutter) { throw 'Flutter nao encontrado. Instale em C:\flutter conforme INSTALACAO.md.' }
    Write-Host "Node $(node --version) | $(docker --version) | Flutter em $flutter"

    Step '2/6 - Arquivos de configuracao'
    foreach ($pair in @(@('backend\.env', 'backend\.env.example'), @('web-panel\.env.local', 'web-panel\.env.example'))) {
        $target = Join-Path $root $pair[0]
        if (-not (Test-Path -LiteralPath $target)) {
            Copy-Item -LiteralPath (Join-Path $root $pair[1]) -Destination $target
            Write-Host "Criado $($pair[0]) a partir do exemplo."
        } else { Write-Host "$($pair[0]) ja existe (mantido)." }
    }

    Step '3/6 - Dependencias do backend e do painel (npm ci)'
    Run $backend { & npm.cmd ci } 'Falha no npm ci do backend.'
    Run $web { & npm.cmd ci } 'Falha no npm ci do painel.'

    Step '4/6 - Docker: Postgres, Redis, MinIO e backend'
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        $dockerApp = @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe", "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $dockerApp) { throw 'Docker Desktop nao localizado. Abra-o manualmente e rode este instalador de novo.' }
        Start-Process -FilePath $dockerApp
        Wait-Until { & docker info *> $null; $LASTEXITCODE -eq 0 } 300 'Docker nao ficou pronto em 5 minutos. Confira a janela do Docker Desktop.'
    }
    Run $backend { & docker compose up -d --build } 'Falha ao subir os containers.'
    Wait-Until { (& docker inspect -f '{{.State.Health.Status}}' backend-postgres-1 2>$null) -eq 'healthy' } 180 'O Postgres nao ficou saudavel.'

    Step '5/6 - Banco: migrations, usuario Master e Empresa Demo'
    Run $backend { & npm.cmd run migration:run } 'Falha nas migrations.'
    Run $backend { & npm.cmd run seed } 'Falha no seed do Master.'
    Run $backend { & npm.cmd run seed:demo } 'Falha no seed da Empresa Demo.'
    # O backend sobe antes das tabelas existirem na primeira vez: reinicia para ele ler o banco pronto.
    Run $backend { & docker compose restart backend } 'Falha ao reiniciar o backend.'

    Step '6/6 - App Flutter (flutter pub get)'
    Run $mobile { & $flutter pub get } 'Falha no flutter pub get.'
    @{ flutterPath = $flutter } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'SAFEPOW-iniciador.config.json') -Encoding UTF8

    Write-Host "`nInstalacao concluida." -ForegroundColor Green
    Write-Host 'Agora abra o "INICIAR PROJETO.bat" (painel em http://localhost:3001 e app no emulador).'
    Write-Host 'Logins: botoes "Entrar como ..." na tela de login do painel.'
    Pause-End
} catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Corrija o problema e rode o instalador de novo (ele pode ser repetido sem estragar nada).'
    Pause-End
    exit 1
}
exit 0
