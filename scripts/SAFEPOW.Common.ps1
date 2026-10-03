# Funcoes compartilhadas; Windows PowerShell 5.1. Dot-source nao inicia servicos.
function Read-SafepowEnv([string]$Path) {
    $values = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [IO.File]::ReadAllLines($Path)) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
                $value = $matches[2]
                $key = $matches[1]
                if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                    $value = $value.Substring(1, $value.Length - 2)
                } else { $value = ($value -replace '\s+#.*$', '').Trim() }
                $values[$key] = $value
            }
        }
    }
    return $values
}

function Initialize-SafepowEnv([string]$Root) {
    $path = Join-Path $Root 'backend\.env'
    if (-not (Test-Path -LiteralPath $path)) {
        $template = [IO.File]::ReadAllText((Join-Path $Root 'backend\.env.example'))
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
        $template = [regex]::Replace($template, '(?m)^JWT_SECRET=.*$', "JWT_SECRET=$secret")
        [IO.File]::WriteAllText($path, $template, (New-Object Text.UTF8Encoding $false))
        Write-Host 'Configuracao local criada em backend\.env (JWT exclusivo desta instalacao).'
    } else { Write-Host 'backend\.env existente preservado.' }
}

function Invoke-SafepowDocker {
    param([string[]]$Arguments, [switch]$Capture)
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        if ($Capture) { $output = & docker @Arguments 2>&1 } else { & docker @Arguments }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($code -ne 0) {
        if ($Capture) { $output | ForEach-Object { Write-Host "$_" } }
        throw "Docker falhou (codigo $code). Consulte a mensagem acima e SAFEPOW.bat (opcao Diagnosticar)."
    }
    if ($Capture) { return (($output | ForEach-Object { "$_" }) -join "`n").Trim() }
}

function Get-SafepowComposeArgs([string]$Root, [string]$Component = 'Api') {
    if ($Component -eq 'Painel') {
        return @('compose', '--project-name', 'safepow-web', '--project-directory', (Join-Path $Root 'web-panel'),
            '--env-file', (Join-Path $Root 'web-panel\.env.docker'), '-f', (Join-Path $Root 'web-panel\docker-compose.yml'))
    }
    # Mesmo nome anterior: preserva backend_postgres_data e backend_minio_data.
    return @('compose', '--project-name', 'backend', '--project-directory', (Join-Path $Root 'backend'),
        '--env-file', (Join-Path $Root 'backend\.env'), '-f', (Join-Path $Root 'backend\docker-compose.yml'))
}

function Initialize-SafepowWebEnv([string]$Root) {
    $target = Join-Path $Root 'web-panel\.env.docker'
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-Item -LiteralPath (Join-Path $Root 'web-panel\.env.docker.example') -Destination $target
        # Preserva porta e nome do cookie da antiga instalacao conjunta.
        $previous = Read-SafepowEnv (Join-Path $Root 'backend\.env')
        foreach ($key in @('WEB_PORT', 'SESSION_COOKIE_NAME')) {
            if ($previous.ContainsKey($key)) { Set-SafepowEnvValue $target $key $previous[$key] }
        }
        Write-Host 'Configuracao do painel criada em web-panel\.env.docker.'
    }
}

function Set-SafepowEnvValue([string]$Path, [string]$Key, [string]$Value) {
    if ($Key -notmatch '^[A-Z_][A-Z0-9_]*$' -or $Value -match '[\r\n]') { throw 'Configuracao invalida.' }
    $content = [IO.File]::ReadAllText($Path)
    $pattern = '(?m)^' + [regex]::Escape($Key) + '=.*$'
    $line = "$Key=$Value"
    if ([regex]::IsMatch($content, $pattern)) {
        $content = [regex]::Replace($content, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
    } else { $content = $content.TrimEnd() + "`r`n$line`r`n" }
    [IO.File]::WriteAllText($Path, $content, (New-Object Text.UTF8Encoding $false))
}

function Initialize-SafepowNetwork {
    $network = Invoke-SafepowDocker -Arguments @('network', 'ls', '--filter', 'name=^safepow-local$', '--format', '{{.Name}}') -Capture
    if (-not $network) { Invoke-SafepowDocker -Arguments @('network', 'create', 'safepow-local') }
}

function Stop-SafepowLegacyWeb {
    # Somente o painel do projeto antigo; nunca remove containers ou volumes do banco.
    $ids = Invoke-SafepowDocker -Arguments @('ps', '-q', '--filter', 'label=com.docker.compose.project=backend', '--filter', 'label=com.docker.compose.service=web') -Capture
    if ($ids) {
        Write-Host 'Parando o painel da instalacao antiga para liberar sua porta. O novo painel tem Compose proprio.'
        Invoke-SafepowDocker -Arguments (@('stop') + @($ids -split '\s+'))
        # Evita o painel antigo ocupar a porta novamente quando Docker reiniciar.
        Invoke-SafepowDocker -Arguments (@('update', '--restart=no') + @($ids -split '\s+'))
    }
}

function Wait-Safepow([scriptblock]$Check, [int]$Seconds, [string]$Failure) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Check) { return }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    throw $Failure
}

function Test-SafepowDocker {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = & docker info --format '{{.OSType}}' 2>$null
        return ($LASTEXITCODE -eq 0 -and "$result".Trim() -eq 'linux')
    } finally { $ErrorActionPreference = $previousPreference }
}

function Start-SafepowDocker {
    $env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Instale Docker Desktop (https://www.docker.com/products/docker-desktop/) e execute novamente. Winget nao disponivel.' }
        Write-Host 'Instalando Docker Desktop. O Windows pode solicitar permissao de administrador e reinicializacao.'
        & winget install --id Docker.DockerDesktop --exact --source winget
        if ($LASTEXITCODE -ne 0) { throw 'Instalacao do Docker nao concluida. Conclua o instalador/reinicie o Windows e execute novamente.' }
        $env:Path += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker instalado. Reinicie o Windows e execute SAFEPOW.bat (opcao Iniciar) novamente.' }
    }
    if (-not (Test-SafepowDocker)) {
        $desktop = @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe", "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe") |
            Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $desktop) { throw 'Docker nao esta pronto. Abra Docker Desktop e selecione containers Linux.' }
        Start-Process -FilePath $desktop -WindowStyle Hidden
        Write-Host 'Aguardando Docker (ate 4 minutos). No primeiro uso, conclua a configuracao do Docker Desktop.'
        Wait-Safepow { Test-SafepowDocker } 240 'Docker Linux nao iniciou. Abra Docker Desktop; confira WSL 2 e virtualizacao. Se solicitou reinicializacao, reinicie e tente novamente.'
    }
    Invoke-SafepowDocker -Arguments @('compose', 'version')
}

function Get-SafepowServiceState([string[]]$Compose, [string]$Service) {
    $id = Invoke-SafepowDocker -Arguments ($Compose + @('ps', '--all', '-q', $Service)) -Capture
    if (-not $id) { return 'missing' }
    return Invoke-SafepowDocker -Arguments @('inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', $id) -Capture
}

function Backup-SafepowDatabase([string]$Root, [string[]]$Compose) {
    # Arquivo binario criado no container e copiado: evita corrupcao pelo PowerShell 5.1.
    # Sem shell intermediario: preserva argumentos no Windows PowerShell 5.1.
    # Tambem salva um banco vazio na primeira instalacao; nunca pula backup por parsing de SQL.
    $dbUser = Invoke-SafepowDocker -Arguments ($Compose + @('exec', '-T', 'postgres', 'printenv', 'POSTGRES_USER')) -Capture
    $dbName = Invoke-SafepowDocker -Arguments ($Compose + @('exec', '-T', 'postgres', 'printenv', 'POSTGRES_DB')) -Capture
    if (-not $dbUser -or -not $dbName) { throw 'Nao foi possivel identificar o banco para backup.' }
    $dir = Join-Path $Root 'SAFEPOW-backups'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $name = 'antes-inicio-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.dump'
    Write-Host "Preservando banco existente em SAFEPOW-backups\$name"
    Invoke-SafepowDocker -Arguments ($Compose + @('exec', '-T', 'postgres', 'pg_dump', '--username', $dbUser,
        '--dbname', $dbName, '--format=custom', '--file=/tmp/safepow-before-setup.dump'))
    Invoke-SafepowDocker -Arguments ($Compose + @('cp', 'postgres:/tmp/safepow-before-setup.dump', (Join-Path $dir $name)))
    $stream = [IO.File]::OpenRead((Join-Path $dir $name))
    try {
        $header = New-Object byte[] 5
        if ($stream.Read($header, 0, 5) -ne 5 -or [Text.Encoding]::ASCII.GetString($header) -ne 'PGDMP') { throw 'Backup invalido. Inicializacao interrompida antes das migrations.' }
    } finally { $stream.Dispose() }
}
