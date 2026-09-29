$ErrorActionPreference = 'Stop'
try {
    $logDir = Join-Path $PSScriptRoot 'SAFEPOW-logs'
    foreach ($name in @('painel', 'mobile')) {
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
    Push-Location -LiteralPath (Join-Path $PSScriptRoot 'backend')
    try {
        & docker compose stop
        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel parar o backend. Confira Docker Desktop.' }
    } finally { Pop-Location }
    Write-Host 'Servicos parados. Voce pode fechar o emulador e o navegador.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Pressione Enter para fechar'
    exit 1
}
