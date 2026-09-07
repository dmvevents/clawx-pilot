param(
    [string]$WindowsUser = $env:USERNAME,
    [string]$ProfilePath = "",
    [string]$ProviderId = "moe-cloud-gateway",
    [string]$ProviderLabel = "MOE Cloud Gateway",
    [string]$BaseUrl = "",
    [string]$ApiKey = "",
    [string]$ApiKeyFile = "",
    [ValidateSet("openai-completions", "openai-responses")]
    [string]$ApiProtocol = "openai-completions",
    [string]$Model = "moe-demo-pro",
    [string[]]$VisibleModels = @("moe-demo", "moe-demo-pro")
)

$ErrorActionPreference = "Stop"

function Write-State {
    param([string]$Message)
    Write-Host ("STATE: " + $Message)
}

function Set-JsonProperty {
    param(
        [Parameter(Mandatory=$true)] [object]$Object,
        [Parameter(Mandatory=$true)] [string]$Name,
        [Parameter(Mandatory=$true)] $Value
    )

    $existing = $Object.PSObject.Properties[$Name]
    if ($existing) {
        $existing.Value = $Value
    } else {
        Add-Member -InputObject $Object -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Remove-JsonProperty {
    param(
        [Parameter(Mandatory=$true)] [object]$Object,
        [Parameter(Mandatory=$true)] [string]$Name
    )

    if ($Object.PSObject.Properties[$Name]) {
        $Object.PSObject.Properties.Remove($Name)
    }
}

function Ensure-ObjectProperty {
    param(
        [Parameter(Mandatory=$true)] [object]$Object,
        [Parameter(Mandatory=$true)] [string]$Name
    )

    $property = $Object.PSObject.Properties[$Name]
    if (-not $property -or $null -eq $property.Value -or $property.Value -isnot [psobject]) {
        Set-JsonProperty -Object $Object -Name $Name -Value ([pscustomobject]@{})
    }
    return $Object.PSObject.Properties[$Name].Value
}

function Read-JsonObject {
    param([Parameter(Mandatory=$true)] [string]$Path)

    if (Test-Path -LiteralPath $Path) {
        $raw = Get-Content -LiteralPath $Path -Raw
        if ($raw.Trim()) {
            return $raw | ConvertFrom-Json
        }
    }

    return [pscustomobject]@{}
}

function Write-JsonObject {
    param(
        [Parameter(Mandatory=$true)] [string]$Path,
        [Parameter(Mandatory=$true)] [object]$Value
    )

    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $json = $Value | ConvertTo-Json -Depth 80
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Backup-File {
    param([Parameter(Mandatory=$true)] [string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = "$Path.gateway-$stamp.bak"
    Copy-Item -LiteralPath $Path -Destination $backupPath -Force
    return $backupPath
}

function Get-RuntimeProviderKey {
    param([Parameter(Mandatory=$true)] [string]$Id)

    if ($Id -match "^custom-[^-]{8}$") {
        return $Id
    }

    $suffix = ($Id -replace "-", "")
    if ($suffix.Length -gt 8) {
        $suffix = $suffix.Substring(0, 8)
    }
    return "custom-$suffix"
}

function Get-NormalizedBaseUrl {
    param([Parameter(Mandatory=$true)] [string]$Url)

    $normalized = $Url.Trim().TrimEnd("/")
    $normalized = $normalized -replace "/chat/completions$", ""
    $normalized = $normalized -replace "/responses$", ""
    if ($normalized -notmatch "^https?://") {
        throw "BaseUrl must start with http:// or https://"
    }
    if ($normalized -notmatch "/v1$") {
        $normalized = "$normalized/v1"
    }
    return $normalized
}

function Get-AgentIds {
    param([Parameter(Mandatory=$true)] [string]$OpenClawDir)

    $agentRoot = Join-Path $OpenClawDir "agents"
    $ids = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $agentRoot) {
        Get-ChildItem -LiteralPath $agentRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.Name.Trim()) {
                $ids.Add($_.Name)
            }
        }
    }
    if ($ids.Count -eq 0) {
        $ids.Add("main")
    }
    return $ids.ToArray()
}

function Upsert-AuthProfile {
    param(
        [Parameter(Mandatory=$true)] [string]$OpenClawDir,
        [Parameter(Mandatory=$true)] [string]$AgentId,
        [Parameter(Mandatory=$true)] [string]$RuntimeProviderKey,
        [Parameter(Mandatory=$true)] [string]$Key
    )

    $authPath = Join-Path $OpenClawDir ("agents\{0}\agent\auth-profiles.json" -f $AgentId)
    $auth = Read-JsonObject -Path $authPath
    if (-not $auth.PSObject.Properties["version"]) {
        Set-JsonProperty -Object $auth -Name "version" -Value 1
    }

    $profiles = Ensure-ObjectProperty -Object $auth -Name "profiles"
    $order = Ensure-ObjectProperty -Object $auth -Name "order"
    $lastGood = Ensure-ObjectProperty -Object $auth -Name "lastGood"
    $profileId = "$RuntimeProviderKey`:default"

    Set-JsonProperty -Object $profiles -Name $profileId -Value ([pscustomobject]@{
        type = "api_key"
        provider = $RuntimeProviderKey
        key = $Key
    })
    Set-JsonProperty -Object $order -Name $RuntimeProviderKey -Value @($profileId)
    Set-JsonProperty -Object $lastGood -Name $RuntimeProviderKey -Value $profileId

    Write-JsonObject -Path $authPath -Value $auth
}

function Upsert-AgentModels {
    param(
        [Parameter(Mandatory=$true)] [string]$OpenClawDir,
        [Parameter(Mandatory=$true)] [string]$AgentId,
        [Parameter(Mandatory=$true)] [string]$RuntimeProviderKey,
        [Parameter(Mandatory=$true)] [string]$GatewayBaseUrl,
        [Parameter(Mandatory=$true)] [string]$Protocol,
        [Parameter(Mandatory=$true)] [string[]]$Models,
        [Parameter(Mandatory=$true)] [string]$Key
    )

    $modelsPath = Join-Path $OpenClawDir ("agents\{0}\agent\models.json" -f $AgentId)
    $modelsJson = Read-JsonObject -Path $modelsPath
    $providers = Ensure-ObjectProperty -Object $modelsJson -Name "providers"

    $modelEntries = @()
    foreach ($m in $Models) {
        if ($m.Trim()) {
            $modelEntries += [pscustomobject]@{
                id = $m.Trim()
                name = $m.Trim()
                cost = [pscustomobject]@{
                    input = 0
                    output = 0
                    cacheRead = 0
                    cacheWrite = 0
                }
            }
        }
    }

    Set-JsonProperty -Object $providers -Name $RuntimeProviderKey -Value ([pscustomobject]@{
        baseUrl = $GatewayBaseUrl
        api = $Protocol
        models = $modelEntries
        apiKey = $Key
        authHeader = $true
    })

    Write-JsonObject -Path $modelsPath -Value $modelsJson
}

if (-not $ApiKey.Trim() -and $ApiKeyFile.Trim()) {
    if (-not (Test-Path -LiteralPath $ApiKeyFile)) {
        throw "ApiKeyFile does not exist: $ApiKeyFile"
    }
    $ApiKey = (Get-Content -LiteralPath $ApiKeyFile -Raw).Trim()
}

if (-not $ApiKey.Trim()) {
    throw "ApiKey is required. Pass the LiteLLM client key; this script does not print it."
}
if (-not $BaseUrl.Trim()) {
    throw "BaseUrl is required. Pass the LiteLLM Cloud Run URL or URL/v1."
}

if (-not $ProfilePath.Trim()) {
    $ProfilePath = Join-Path $env:SystemDrive ("Users\{0}" -f $WindowsUser)
}

$normalizedBaseUrl = Get-NormalizedBaseUrl -Url $BaseUrl
$runtimeProviderKey = Get-RuntimeProviderKey -Id $ProviderId
$modelRef = "$runtimeProviderKey/$Model"
$now = (Get-Date).ToUniversalTime().ToString("o")

$providerStorePath = Join-Path $ProfilePath "AppData\Roaming\Ministry of Education\clawx-providers.json"
$openClawDir = Join-Path $ProfilePath ".openclaw"
$openClawPath = Join-Path $openClawDir "openclaw.json"

Write-State ("targetUser={0}" -f $WindowsUser)
Write-State ("providerId={0} runtimeProviderKey={1} modelRef={2}" -f $ProviderId, $runtimeProviderKey, $modelRef)
Write-State ("baseUrl={0}" -f $normalizedBaseUrl)

$providerBackup = Backup-File -Path $providerStorePath
$openClawBackup = Backup-File -Path $openClawPath

$store = Read-JsonObject -Path $providerStorePath
if (-not $store.PSObject.Properties["schemaVersion"]) {
    Set-JsonProperty -Object $store -Name "schemaVersion" -Value 0
}
$providers = Ensure-ObjectProperty -Object $store -Name "providers"
$providerAccounts = Ensure-ObjectProperty -Object $store -Name "providerAccounts"
$apiKeys = Ensure-ObjectProperty -Object $store -Name "apiKeys"
$providerSecrets = Ensure-ObjectProperty -Object $store -Name "providerSecrets"

foreach ($accountProperty in @($providerAccounts.PSObject.Properties)) {
    if ($accountProperty.Value -and $accountProperty.Value.PSObject.Properties["isDefault"]) {
        $accountProperty.Value.PSObject.Properties["isDefault"].Value = $false
    }
}

$legacyProvider = [pscustomobject]@{
    id = $ProviderId
    name = $ProviderLabel
    type = "custom"
    baseUrl = $normalizedBaseUrl
    apiProtocol = $ApiProtocol
    model = $Model
    fallbackModels = @()
    fallbackProviderIds = @()
    enabled = $true
    createdAt = $now
    updatedAt = $now
}

$account = [pscustomobject]@{
    id = $ProviderId
    vendorId = "custom"
    label = $ProviderLabel
    authMode = "api_key"
    baseUrl = $normalizedBaseUrl
    apiProtocol = $ApiProtocol
    model = $Model
    fallbackModels = @()
    fallbackAccountIds = @()
    enabled = $true
    isDefault = $true
    metadata = [pscustomobject]@{
        customModels = $VisibleModels
    }
    createdAt = $now
    updatedAt = $now
}

Set-JsonProperty -Object $providers -Name $ProviderId -Value $legacyProvider
Set-JsonProperty -Object $providerAccounts -Name $ProviderId -Value $account
Set-JsonProperty -Object $apiKeys -Name $ProviderId -Value $ApiKey.Trim()
Set-JsonProperty -Object $providerSecrets -Name $ProviderId -Value ([pscustomobject]@{
    type = "api_key"
    accountId = $ProviderId
    apiKey = $ApiKey.Trim()
})
Set-JsonProperty -Object $store -Name "defaultProvider" -Value $ProviderId
Set-JsonProperty -Object $store -Name "defaultProviderAccountId" -Value $ProviderId
Write-JsonObject -Path $providerStorePath -Value $store

$openclaw = Read-JsonObject -Path $openClawPath
$agents = Ensure-ObjectProperty -Object $openclaw -Name "agents"
$defaults = Ensure-ObjectProperty -Object $agents -Name "defaults"
Set-JsonProperty -Object $defaults -Name "model" -Value ([pscustomobject]@{
    primary = $modelRef
    fallbacks = @()
})

$models = Ensure-ObjectProperty -Object $openclaw -Name "models"
$runtimeProviders = Ensure-ObjectProperty -Object $models -Name "providers"
$openClawModels = @()
foreach ($m in $VisibleModels) {
    if ($m.Trim()) {
        $openClawModels += [pscustomobject]@{ id = $m.Trim(); name = $m.Trim() }
    }
}
Set-JsonProperty -Object $runtimeProviders -Name $runtimeProviderKey -Value ([pscustomobject]@{
    baseUrl = $normalizedBaseUrl
    api = $ApiProtocol
    authHeader = $true
    models = $openClawModels
})

$gateway = Ensure-ObjectProperty -Object $openclaw -Name "gateway"
if (-not $gateway.PSObject.Properties["mode"]) {
    Set-JsonProperty -Object $gateway -Name "mode" -Value "local"
}
Write-JsonObject -Path $openClawPath -Value $openclaw

$agentIds = Get-AgentIds -OpenClawDir $openClawDir
foreach ($agentId in $agentIds) {
    Upsert-AuthProfile -OpenClawDir $openClawDir -AgentId $agentId -RuntimeProviderKey $runtimeProviderKey -Key $ApiKey.Trim()
    Upsert-AgentModels -OpenClawDir $openClawDir -AgentId $agentId -RuntimeProviderKey $runtimeProviderKey -GatewayBaseUrl $normalizedBaseUrl -Protocol $ApiProtocol -Models $VisibleModels -Key $ApiKey.Trim()
}

if ($providerBackup) {
    Write-State ("providerBackup={0}" -f $providerBackup)
}
if ($openClawBackup) {
    Write-State ("openClawBackup={0}" -f $openClawBackup)
}
Write-State ("configured gateway provider; apiKeyPresent={0} apiKeyLength={1} agentIds={2}" -f ($ApiKey.Trim().Length -gt 0), $ApiKey.Trim().Length, ($agentIds -join ","))
