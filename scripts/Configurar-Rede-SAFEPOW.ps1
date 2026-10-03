param(
    [ValidateSet('Wifi', 'Usb')][string]$Modo,
    [string]$Endereco,
    [switch]$SemPausa,
    [switch]$SemFirewall,
    [switch]$SomenteFirewall,
    [switch]$RedeConfiavel,
    [int]$InterfaceIndex,
    [ValidateRange(1, 65535)][int]$PortaApi = 3000,
    [ValidateRange(1, 65535)][int]$PortaStorage = 9000
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'SAFEPOW.Common.ps1')
try {
    if ($SomenteFirewall) {
        if ($RedeConfiavel) {
            if ($InterfaceIndex -le 0) { throw 'Interface de rede invalida.' }
            Set-NetConnectionProfile -InterfaceIndex $InterfaceIndex -NetworkCategory Private
        }
        foreach ($entry in @(@('API', $PortaApi), @('Imagens', $PortaStorage))) {
            $name = 'SAFEPOW-LAN-' + $entry[0]
            $existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
            if ($existing) {
                $existing | Set-NetFirewallRule -Enabled True -Profile Private -Direction Inbound -Action Allow
                $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $entry[1]
                $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
            } else {
                New-NetFirewallRule -Name $name -DisplayName "SAFEPOW - $($entry[0]) na rede local" -Group 'SAFEPOW' `
                    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $entry[1] -RemoteAddress LocalSubnet -Profile Private | Out-Null
            }
        }
        Write-Host 'Firewall configurado para API/imagens somente na rede local com perfil Privado.'
        exit 0
    }
    if (-not $Modo) {
        Write-Host '1 - Wi-Fi: celular e computador na mesma rede (USB apenas para instalar o app)'
        Write-Host '2 - USB: conexao de teste pelo cabo'
        $choice = Read-Host 'Escolha [Enter = Wi-Fi]'
        if ($choice -in @('', '1')) { $Modo = 'Wifi' }
        elseif ($choice -eq '2') { $Modo = 'Usb' }
        else { throw 'Opcao invalida. Nenhuma configuracao alterada.' }
    }
    Initialize-SafepowEnv $root
    $envPath = Join-Path $root 'backend\.env'
    $settings = Read-SafepowEnv $envPath
    if ($settings.ContainsKey('PORT')) { $PortaApi = [int]$settings['PORT'] }
    if ($settings.ContainsKey('STORAGE_PORT')) { $PortaStorage = [int]$settings['STORAGE_PORT'] }
    if ($PortaApi -lt 1 -or $PortaApi -gt 65535 -or $PortaStorage -lt 1 -or $PortaStorage -gt 65535) { throw 'Portas invalidas em backend\.env.' }
    $bucket = if ($settings['STORAGE_BUCKET']) { $settings['STORAGE_BUCKET'] } else { 'inventory-saas-uploads' }
    if ($Modo -eq 'Wifi') {
        $adapters = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address })
        if (-not $Endereco) {
            if ($adapters.Count -eq 1) { $Endereco = $adapters[0].IPv4Address[0].IPAddress }
            elseif ($adapters.Count -gt 1) {
                for ($i = 0; $i -lt $adapters.Count; $i++) {
                    Write-Host "$($i+1) - $($adapters[$i].InterfaceAlias): $($adapters[$i].IPv4Address[0].IPAddress)"
                }
                $number = 0
                if (-not [int]::TryParse((Read-Host 'Escolha a rede usada pelo celular'), [ref]$number) -or $number -lt 1 -or $number -gt $adapters.Count) { throw 'Rede invalida.' }
                $Endereco = $adapters[$number-1].IPv4Address[0].IPAddress
            } else { throw 'Nenhuma rede com IPv4/gateway encontrada. Conecte o computador ao Wi-Fi ou Ethernet.' }
        }
        $ip = $null
        if (-not [Net.IPAddress]::TryParse($Endereco, [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or [Net.IPAddress]::IsLoopback($ip)) {
            throw 'Informe o IPv4 do computador na rede local.'
        }
        $adapter = $adapters | Where-Object { $_.IPv4Address.IPAddress -contains $Endereco } | Select-Object -First 1
        if (-not $adapter) { throw 'O IP informado nao pertence a uma interface local com gateway.' }
        $profile = Get-NetConnectionProfile -InterfaceIndex $adapter.InterfaceIndex -ErrorAction SilentlyContinue
        if ($profile.NetworkCategory -ne 'Private' -and -not $RedeConfiavel) {
            Write-Host 'Esta conexao nao esta com perfil Privado. Em uma rede de confianca, ajuste isso nas Configuracoes de Rede do Windows para permitir o acesso do celular.' -ForegroundColor Yellow
        }
        if (-not $SemFirewall) {
            # O perfil so muda quando a rede foi explicitamente indicada como confiavel.
            $file = Join-Path $PSScriptRoot 'Configurar-Rede-SAFEPOW.ps1'
            $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $file + '" -SomenteFirewall -SemPausa -PortaApi ' + $PortaApi + ' -PortaStorage ' + $PortaStorage
            $profileArguments = @()
            if ($RedeConfiavel) {
                $arguments += ' -RedeConfiavel -InterfaceIndex ' + $adapter.InterfaceIndex
                $profileArguments = @('-RedeConfiavel', '-InterfaceIndex', $adapter.InterfaceIndex)
            }
            $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
            if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $file -SomenteFirewall -SemPausa -PortaApi $PortaApi -PortaStorage $PortaStorage @profileArguments
                if ($LASTEXITCODE -ne 0) { throw 'Falha ao configurar firewall.' }
            } else {
                Write-Host 'O Windows solicitara permissao para liberar API e imagens na rede privada.'
                $process = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -Wait -PassThru
                if ($process.ExitCode -ne 0) { throw 'Firewall nao configurado. Repita a configuracao e autorize o Windows.' }
            }
        }
        Set-SafepowEnvValue $envPath 'API_BIND_ADDRESS' '0.0.0.0'
        Set-SafepowEnvValue $envPath 'STORAGE_BIND_ADDRESS' '0.0.0.0'
        $apiBase = "http://${Endereco}:$PortaApi/api"
        $storageBase = "http://${Endereco}:$PortaStorage/$bucket"
    } else {
        Set-SafepowEnvValue $envPath 'API_BIND_ADDRESS' '127.0.0.1'
        Set-SafepowEnvValue $envPath 'STORAGE_BIND_ADDRESS' '127.0.0.1'
        $apiBase = "http://127.0.0.1:$PortaApi/api"
        $storageBase = "http://localhost:$PortaStorage/$bucket"
    }
    Set-SafepowEnvValue $envPath 'STORAGE_PUBLIC_BASE_URL' $storageBase
    $mobileConfig = @{ API_BASE_URL = $apiBase; CONNECTION_MODE = $Modo.ToLowerInvariant(); STORAGE_PORT = "$PortaStorage" } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $root 'mobile_app\env.local.json'), $mobileConfig, (New-Object Text.UTF8Encoding $false))
    Write-Host "`nApp configurado: $apiBase ($Modo)" -ForegroundColor Green
    if ($SemFirewall -and $Modo -eq 'Wifi') { Write-Host 'Firewall nao foi alterado nesta execucao.' -ForegroundColor Yellow }
    Write-Host 'Agora escolha 7 para aplicar a configuracao da API e depois 4 para reinstalar/abrir o app.'
    Write-Host 'No Wi-Fi, abra esse endereco com /health no navegador do celular para conferir a conexao.'
    Write-Host 'Se o IP do computador mudar, repita esta configuracao e reinstale o app. Reserve o IP no roteador para evitar isso.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' | Out-Null }
    exit 1
}
