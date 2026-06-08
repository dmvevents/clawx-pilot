param(
    [string]$SourceUser = "VYONIX",
    [string]$TargetUser = $env:USERNAME,
    [string]$SourceProfilePath = "",
    [string]$TargetProfilePath = "",
    [string]$ProviderId = "google",
    [string]$Model = "gemini-2.5-pro"
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

    $property = $Object.PSObject.Properties[$Name]
    if ($property) {
        $property.Value = $Value
    } else {
        Add-Member -InputObject $Object -NotePropertyName $Name -NotePropertyValue $Value
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
    param(
        [Parameter(Mandatory=$true)] [string]$Path,
        [Parameter(Mandatory=$true)] [string]$Tag
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = "$Path.$Tag-$stamp.bak"
    Copy-Item -LiteralPath $Path -Destination $backupPath -Force
    return $backupPath
}

function Get-AgentIds {
    param([Parameter(Mandatory=$true)] [string]$OpenClawDir)

    $agentRoot = Join-Path $OpenClawDir "agents"
    $ids = @()
    if (Test-Path -LiteralPath $agentRoot) {
        $ids = @(Get-ChildItem -LiteralPath $agentRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    }
    if ($ids.Count -eq 0) {
        $ids = @("main")
    }
    return $ids
}

function Upsert-AuthProfile {
    param(
        [Parameter(Mandatory=$true)] [string]$OpenClawDir,
        [Parameter(Mandatory=$true)] [string]$AgentId,
        [Parameter(Mandatory=$true)] [string]$Provider,
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
    $profileId = "$Provider`:default"

    Set-JsonProperty -Object $profiles -Name $profileId -Value ([pscustomobject]@{
        type = "api_key"
        provider = $Provider
        key = $Key
    })
    Set-JsonProperty -Object $order -Name $Provider -Value @($profileId)
    Set-JsonProperty -Object $lastGood -Name $Provider -Value $profileId

    Write-JsonObject -Path $authPath -Value $auth
}

if (-not $SourceProfilePath.Trim()) {
    $SourceProfilePath = Join-Path $env:SystemDrive ("Users\{0}" -f $SourceUser)
}
if (-not $TargetProfilePath.Trim()) {
    $TargetProfilePath = Join-Path $env:SystemDrive ("Users\{0}" -f $TargetUser)
}

$sourceStorePath = Join-Path $SourceProfilePath "AppData\Roaming\Ministry of Education\clawx-providers.json"
$targetStorePath = Join-Path $TargetProfilePath "AppData\Roaming\Ministry of Education\clawx-providers.json"
$openClawDir = Join-Path $TargetProfilePath ".openclaw"
$openClawPath = Join-Path $openClawDir "openclaw.json"

$sourceStore = Read-JsonObject -Path $sourceStorePath
$sourceSecret = $null
if ($sourceStore.PSObject.Properties["providerSecrets"]) {
    $sourceSecret = $sourceStore.providerSecrets.PSObject.Properties[$ProviderId].Value
}

$key = $null
if ($sourceSecret -and $sourceSecret.PSObject.Properties["apiKey"]) {
    $key = [string]$sourceSecret.apiKey
}
if (-not $key -and $sourceStore.PSObject.Properties["apiKeys"] -and $sourceStore.apiKeys.PSObject.Properties[$ProviderId]) {
    $key = [string]$sourceStore.apiKeys.PSObject.Properties[$ProviderId].Value
}
if (-not $key) {
    throw "Source provider key is missing for provider '$ProviderId'."
}

$targetStore = Read-JsonObject -Path $targetStorePath
$providerBackup = Backup-File -Path $targetStorePath -Tag "provider-copy"
$openClawBackup = Backup-File -Path $openClawPath -Tag "provider-copy"

if (-not $targetStore.PSObject.Properties["schemaVersion"]) {
    Set-JsonProperty -Object $targetStore -Name "schemaVersion" -Value 0
}
$providers = Ensure-ObjectProperty -Object $targetStore -Name "providers"
$accounts = Ensure-ObjectProperty -Object $targetStore -Name "providerAccounts"
$apiKeys = Ensure-ObjectProperty -Object $targetStore -Name "apiKeys"
$secrets = Ensure-ObjectProperty -Object $targetStore -Name "providerSecrets"

foreach ($accountProperty in @($accounts.PSObject.Properties)) {
    if ($accountProperty.Value -and $accountProperty.Value.PSObject.Properties["isDefault"]) {
        $accountProperty.Value.PSObject.Properties["isDefault"].Value = $false
    }
}

$now = (Get-Date).ToUniversalTime().ToString("o")
$sourceLegacy = $null
if ($sourceStore.PSObject.Properties["providers"] -and $sourceStore.providers.PSObject.Properties[$ProviderId]) {
    $sourceLegacy = $sourceStore.providers.PSObject.Properties[$ProviderId].Value
}
if ($sourceLegacy) {
    $legacy = $sourceLegacy
} else {
    $legacy = [pscustomobject]@{
        id = $ProviderId
        name = $ProviderId
        type = $ProviderId
        enabled = $true
        createdAt = $now
        updatedAt = $now
    }
}

Set-JsonProperty -Object $legacy -Name "id" -Value $ProviderId
Set-JsonProperty -Object $legacy -Name "model" -Value $Model
Set-JsonProperty -Object $legacy -Name "enabled" -Value $true
Set-JsonProperty -Object $legacy -Name "updatedAt" -Value $now

$sourceAccount = $null
if ($sourceStore.PSObject.Properties["providerAccounts"] -and $sourceStore.providerAccounts.PSObject.Properties[$ProviderId]) {
    $sourceAccount = $sourceStore.providerAccounts.PSObject.Properties[$ProviderId].Value
}
if ($sourceAccount) {
    $account = $sourceAccount
} else {
    $account = [pscustomobject]@{
        id = $ProviderId
        vendorId = $ProviderId
        label = $ProviderId
        authMode = "api_key"
        enabled = $true
        createdAt = $now
        updatedAt = $now
    }
}

Set-JsonProperty -Object $account -Name "id" -Value $ProviderId
Set-JsonProperty -Object $account -Name "vendorId" -Value $ProviderId
Set-JsonProperty -Object $account -Name "authMode" -Value "api_key"
Set-JsonProperty -Object $account -Name "model" -Value $Model
Set-JsonProperty -Object $account -Name "enabled" -Value $true
Set-JsonProperty -Object $account -Name "isDefault" -Value $true
Set-JsonProperty -Object $account -Name "updatedAt" -Value $now

Set-JsonProperty -Object $providers -Name $ProviderId -Value $legacy
Set-JsonProperty -Object $accounts -Name $ProviderId -Value $account
Set-JsonProperty -Object $apiKeys -Name $ProviderId -Value $key
Set-JsonProperty -Object $secrets -Name $ProviderId -Value ([pscustomobject]@{
    type = "api_key"
    accountId = $ProviderId
    apiKey = $key
})
Set-JsonProperty -Object $targetStore -Name "defaultProvider" -Value $ProviderId
Set-JsonProperty -Object $targetStore -Name "defaultProviderAccountId" -Value $ProviderId
Write-JsonObject -Path $targetStorePath -Value $targetStore

$openclaw = Read-JsonObject -Path $openClawPath
$agents = Ensure-ObjectProperty -Object $openclaw -Name "agents"
$defaults = Ensure-ObjectProperty -Object $agents -Name "defaults"
Set-JsonProperty -Object $defaults -Name "model" -Value ([pscustomobject]@{
    primary = "$ProviderId/$Model"
    fallbacks = @()
})

$models = Ensure-ObjectProperty -Object $openclaw -Name "models"
$runtimeProviders = Ensure-ObjectProperty -Object $models -Name "providers"
if ($runtimeProviders.PSObject.Properties[$ProviderId]) {
    $runtimeProviders.PSObject.Properties.Remove($ProviderId)
}

$gateway = Ensure-ObjectProperty -Object $openclaw -Name "gateway"
if (-not $gateway.PSObject.Properties["mode"]) {
    Set-JsonProperty -Object $gateway -Name "mode" -Value "local"
}
Write-JsonObject -Path $openClawPath -Value $openclaw

$agentIds = Get-AgentIds -OpenClawDir $openClawDir
foreach ($agentId in $agentIds) {
    Upsert-AuthProfile -OpenClawDir $openClawDir -AgentId $agentId -Provider $ProviderId -Key $key
}

Write-State ("copiedProvider source={0} target={1} provider={2} model={3}/{4} apiKeyPresent={5} apiKeyLength={6} agents={7}" -f $SourceUser, $TargetUser, $ProviderId, $ProviderId, $Model, ($key.Length -gt 0), $key.Length, ($agentIds -join ","))
if ($providerBackup) {
    Write-State ("providerBackup={0}" -f $providerBackup)
}
if ($openClawBackup) {
    Write-State ("openClawBackup={0}" -f $openClawBackup)
}
