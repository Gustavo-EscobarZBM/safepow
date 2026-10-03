param([ValidateSet('Todos', 'Api', 'Painel', 'App')][string]$Componente = 'Todos', [switch]$SemPausa)
$projectRoot = Split-Path -Parent $PSScriptRoot
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SAFEPOW.Common.ps1')
try {
    $logDir = Join-Path $projectRoot 'SAFEPOW-logs'
    $processNames = @()
    if ($Componente -in @('Todos', 'Painel')) { $processNames += 'painel' }
    if ($Componente -in @('Todos', 'App')) { $processNames += 'mobile' }
    foreach ($name in $processNames) {
        $state = Join-Path $logDir ($name + '.process.json')
        if (Test-Path -LiteralPath $state) {
            $saved = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$saved.pid)" -ErrorAction SilentlyContinue
            # Confere o comando antes de encerrar para evitar atingir um PID reutilizado.
            if ($process -and $process.CommandLine -like ('*' + $saved.token + '*')) {
                & taskkill.exe /PID $saved.pid /T /F
                if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel parar $name." }
            }
            Remove-Item -LiteralPath $state
        }
    }
    foreach ($part in @('Painel', 'Api')) {
        if ($Componente -ne 'Todos' -and $Componente -ne $part) { continue }
        $envPath = if ($part -eq 'Api') { 'backend\.env' } else { 'web-panel\.env.docker' }
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $envPath))) { continue }
        $compose = Get-SafepowComposeArgs $projectRoot $part
        Invoke-SafepowDocker -Arguments ($compose + @('stop'))
        if ($part -eq 'Painel') { Stop-SafepowLegacyWeb }
    }
    Write-Host "$Componente parado. Dados preservados."
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
    exit 1
}
