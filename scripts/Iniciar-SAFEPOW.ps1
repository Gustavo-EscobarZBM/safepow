# API e painel tem projetos Compose independentes. O menu pode iniciar ambos.
param(
    [ValidateSet('Todos', 'Api', 'Painel')][string]$Componente = 'Todos',
    [switch]$Atualizar, [switch]$SemNavegador, [switch]$SemPausa
)
$projectRoot = Split-Path -Parent $PSScriptRoot
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SAFEPOW.Common.ps1')
$mutex = New-Object Threading.Mutex($false, 'Local\SAFEPOW-backend-installer')
$locked = $false
$transcribing = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Outro iniciador SAFEPOW esta em execucao. Aguarde a conclusao.' }
    $logDir = Join-Path $projectRoot 'SAFEPOW-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Start-Transcript -Path (Join-Path $logDir ('inicio-' + $Componente + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')) | Out-Null
    $transcribing = $true
    Start-SafepowDocker
    Initialize-SafepowNetwork
    $components = if ($Componente -eq 'Todos') { @('Api', 'Painel') } else { @($Componente) }
    foreach ($part in $components) {
        Write-Host "`nPreparando $part..." -ForegroundColor Cyan
        if ($part -eq 'Api') { Initialize-SafepowEnv $projectRoot }
        else { Initialize-SafepowWebEnv $projectRoot }
        $compose = Get-SafepowComposeArgs $projectRoot $part
        Invoke-SafepowDocker -Arguments ($compose + @('config', '--quiet'))
        $config = (Invoke-SafepowDocker -Arguments ($compose + @('config', '--format', 'json')) -Capture) | ConvertFrom-Json
        $service = if ($part -eq 'Api') { 'backend' } else { 'web' }
        $tag = if ($part -eq 'Api') { 'safepow-api:local' } else { 'safepow-web:local' }
        $image = Invoke-SafepowDocker -Arguments @('image', 'ls', '-q', $tag) -Capture
        if ($Atualizar -or -not $image) {
            Write-Host "Compilando $part. Na primeira vez pode levar varios minutos."
            Invoke-SafepowDocker -Arguments ($compose + @('build', $service))
        }
        if ($part -eq 'Painel') { Stop-SafepowLegacyWeb }
        $services = if ($part -eq 'Api') { @('postgres', 'redis', 'minio', 'backend') } else { @('web') }
        foreach ($item in $services) {
            $state = Get-SafepowServiceState $compose $item
            if ($state -notin @('running', 'healthy', 'starting', 'unhealthy')) {
                foreach ($port in $config.services.$item.ports) {
                    if (Get-NetTCPConnection -State Listen -LocalPort ([int]$port.published) -ErrorAction SilentlyContinue) {
                        throw "Porta $($port.published) ocupada. Confira a configuracao de $part e a opcao Diagnosticar."
                    }
                }
            }
        }
        if ($part -eq 'Api') {
            Invoke-SafepowDocker -Arguments ($compose + @('up', '-d', 'postgres', 'redis', 'minio'))
            Wait-Safepow { (Get-SafepowServiceState $compose 'postgres') -eq 'healthy' } 180 'Postgres nao ficou pronto.'
            Backup-SafepowDatabase $projectRoot $compose
            Invoke-SafepowDocker -Arguments ($compose + @('stop', 'backend'))
            Invoke-SafepowDocker -Arguments ($compose + @('up', '-d', '--no-deps', '--force-recreate', 'setup', 'minio-init'))
        }
        Invoke-SafepowDocker -Arguments ($compose + @('up', '-d', '--no-build', $service))
        Wait-Safepow { (Get-SafepowServiceState $compose $service) -eq 'healthy' } 180 "$part nao ficou saudavel. Use Diagnosticar no menu."
        $port = $config.services.$service.ports[0].published
        if ($part -eq 'Api') {
            $health = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 10
            if ($health.service -ne 'safepow-api' -or $health.status -ne 'ok') { throw 'A API nao respondeu como SAFEPOW.' }
            Write-Host "API pronta: http://localhost:$port/api" -ForegroundColor Green
            $mobileConfig = Join-Path $projectRoot 'mobile_app\env.local.json'
            if (Test-Path -LiteralPath $mobileConfig) {
                Write-Host ('Endereco configurado no app: ' + (Get-Content -LiteralPath $mobileConfig -Raw | ConvertFrom-Json).API_BASE_URL)
            }
        } else {
            Write-Host "Painel pronto: http://localhost:$port" -ForegroundColor Green
            Write-Host 'O painel inicia sozinho; login e dados exigem a API ligada.'
            if (-not $SemNavegador) { Start-Process "http://localhost:$port" }
        }
    }
    Write-Host 'API: backend\.env | Painel: web-panel\.env.docker | App: mobile_app\env.local.json'
} catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Volumes preservados. Consulte SAFEPOW-logs ou a opcao Diagnosticar.'
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' | Out-Null }
    exit 1
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
