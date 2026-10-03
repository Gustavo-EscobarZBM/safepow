param([switch]$SemPausa)
$projectRoot = Split-Path -Parent $PSScriptRoot
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SAFEPOW.Common.ps1')
$failed = $false
$transcribing = $false
try {
    $logDir = Join-Path $projectRoot 'SAFEPOW-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Start-Transcript -Path (Join-Path $logDir ('diagnostico-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')) | Out-Null
    $transcribing = $true
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker nao instalado. Use Iniciar no menu.' }
    if (-not (Test-SafepowDocker)) { throw 'Docker Linux indisponivel. Abra Docker Desktop e confira WSL 2 / virtualizacao.' }
    foreach ($part in @('Api', 'Painel')) {
        Write-Host "`n=== $part ===" -ForegroundColor Cyan
        $envPath = if ($part -eq 'Api') { 'backend\.env' } else { 'web-panel\.env.docker' }
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $envPath))) {
            Write-Host "$part ainda nao foi configurado. Use a opcao de iniciar esse componente."
            continue
        }
        try {
            $compose = Get-SafepowComposeArgs $projectRoot $part
            Invoke-SafepowDocker -Arguments ($compose + @('config', '--quiet'))
            Invoke-SafepowDocker -Arguments ($compose + @('ps', '--all'))
            $services = if ($part -eq 'Api') { @('postgres', 'redis', 'backend') } else { @('web') }
            foreach ($service in $services) {
                $state = Get-SafepowServiceState $compose $service
                Write-Host "${service}: $state"
                if ($state -ne 'healthy') { $failed = $true }
            }
            $logs = if ($part -eq 'Api') { @('postgres', 'setup', 'minio-init', 'backend') } else { @('web') }
            Invoke-SafepowDocker -Arguments ($compose + @('logs', '--no-color', '--tail', '20') + $logs)
        } catch { $failed = $true; Write-Host $_.Exception.Message -ForegroundColor Red }
    }
    $mobile = Join-Path $projectRoot 'mobile_app\env.local.json'
    if (Test-Path -LiteralPath $mobile) {
        $config = Get-Content -LiteralPath $mobile -Raw | ConvertFrom-Json
        Write-Host "`nApp: $($config.CONNECTION_MODE) | $($config.API_BASE_URL)"
        Write-Host 'No Wi-Fi: computador e celular na mesma rede, perfil Privado no Windows e firewall liberado pela opcao 9.'
    }
    if (Test-Path -LiteralPath (Join-Path $logDir 'mobile.log')) {
        Write-Host "`nUltimas mensagens do app:"
        Get-Content -LiteralPath (Join-Path $logDir 'mobile.log') -Tail 15
    }
    Write-Host 'API e painel sao independentes. O painel pode estar ligado com a API parada; nesse caso login/dados nao funcionam.'
    Write-Host 'Password authentication failed: confira backend\.env; mudar o arquivo nao altera senhas de um volume existente.'
} catch {
    $failed = $true
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' | Out-Null }
}
if ($failed) { exit 1 }
