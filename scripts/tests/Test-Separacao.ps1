# Verifica contratos dos Composes sem subir/parar containers nem alterar dados.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'scripts\SAFEPOW.Common.ps1')
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$api = (Invoke-SafepowDocker -Arguments @('compose', '--env-file', (Join-Path $root 'backend\.env.example'), '-f', (Join-Path $root 'backend\docker-compose.yml'), 'config', '--format', 'json') -Capture) | ConvertFrom-Json
$web = (Invoke-SafepowDocker -Arguments @('compose', '--env-file', (Join-Path $root 'web-panel\.env.docker.example'), '-f', (Join-Path $root 'web-panel\docker-compose.yml'), 'config', '--format', 'json') -Capture) | ConvertFrom-Json
Assert ($api.name -eq 'backend') 'Nome antigo do projeto deve preservar os volumes.'
Assert ($api.volumes.postgres_data.name -eq 'backend_postgres_data') 'Volume do banco mudou.'
Assert ($api.volumes.minio_data.name -eq 'backend_minio_data') 'Volume de arquivos mudou.'
Assert (-not $api.services.web) 'Backend nao pode conter o painel.'
Assert (@($web.services.PSObject.Properties).Count -eq 1) 'Painel deve conter apenas o servico web.'
Assert (-not $web.services.web.depends_on) 'Painel nao pode depender do ciclo de vida da API.'
Assert ($web.services.web.environment.BACKEND_URL -eq 'http://safepow-api:3000/api') 'Painel deve usar DNS interno do Docker.'
Assert ($api.networks.clients.name -eq $web.networks.clients.name) 'API e painel precisam compartilhar a rede dos clientes.'
Assert ($api.networks.clients.external -and $web.networks.clients.external) 'Rede compartilhada nao deve pertencer ao ciclo de vida de um componente.'
Assert (-not $api.services.postgres.networks.clients) 'Banco nao deve entrar na rede do painel.'
Assert ($api.services.postgres.ports[0].host_ip -eq '127.0.0.1') 'Banco nao deve ser exposto na LAN.'
Assert ($api.services.redis.ports[0].host_ip -eq '127.0.0.1') 'Redis nao deve ser exposto na LAN.'
Assert ((Get-SafepowComposeArgs $root 'Painel') -contains (Join-Path $root 'web-panel\.env.docker')) 'Painel deve ter configuracao propria.'
$dir = Join-Path $root 'SAFEPOW-logs'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$temp = Join-Path $dir ('env-test-' + [Guid]::NewGuid().ToString('N') + '.txt')
try {
    [IO.File]::WriteAllText($temp, "PASSWORD=preserve-this`nPORT=3000`n", (New-Object Text.UTF8Encoding $false))
    Set-SafepowEnvValue $temp 'PORT' '3100'
    Set-SafepowEnvValue $temp 'API_BIND_ADDRESS' '0.0.0.0'
    $values = Read-SafepowEnv $temp
    Assert ($values['PASSWORD'] -eq 'preserve-this') 'Atualizacao de rede alterou outro valor.'
    Assert ($values['PORT'] -eq '3100' -and $values['API_BIND_ADDRESS'] -eq '0.0.0.0') 'Configuracao de rede nao foi gravada.'
} finally { Remove-Item -LiteralPath $temp }
Write-Host 'OK: separacao dos projetos, DNS interno, isolamento do banco, volumes e edicao da configuracao.' -ForegroundColor Green
