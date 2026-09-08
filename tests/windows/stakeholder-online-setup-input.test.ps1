# Cross-platform input-contract checks; native ACL/commit checks are separate.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $repo 'windows-pilot/scripts/setup-ministry-online.ps1')
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ministry-setup-input-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($scratch) | Out-Null
$configPath = Join-Path $scratch 'private.json'
$keyPath = Join-Path $scratch 'client.key'
$utf8 = New-Object Text.UTF8Encoding($false)
$cases = @(
  @{ name = 'default public aliases'; change = @{}; expected = 'OK' },
  @{ name = 'alternate public alias'; change = @{ model = 'moe-demo' }; expected = 'OK' },
  @{ name = 'HTTP refused'; change = @{ baseUrl = 'http://setup.invalid/v1' }; expected = 'CONFIG_INVALID' },
  @{ name = 'missing v1 refused'; change = @{ baseUrl = 'https://setup.invalid/' }; expected = 'CONFIG_INVALID' },
  @{ name = 'query refused'; change = @{ baseUrl = 'https://setup.invalid/v1?q=x' }; expected = 'CONFIG_INVALID' },
  @{ name = 'fragment refused'; change = @{ baseUrl = 'https://setup.invalid/v1#x' }; expected = 'CONFIG_INVALID' },
  @{ name = 'URL userinfo refused'; change = @{ baseUrl = 'https://a:b@setup.invalid/v1' }; expected = 'CONFIG_INVALID' },
  @{ name = 'missing endpoint refused'; change = @{ baseUrl = $null }; expected = 'CONFIG_INVALID' },
  @{ name = 'upstream model refused'; change = @{ model = 'gemini-2.5-pro' }; expected = 'CONFIG_INVALID' },
  @{ name = 'case-changed alias refused'; change = @{ model = 'MOE-DEMO' }; expected = 'CONFIG_INVALID' },
  @{ name = 'unknown model list refused'; change = @{ models = @('moe-demo-pro', 'other') }; expected = 'CONFIG_INVALID' },
  @{ name = 'duplicate model list refused'; change = @{ models = @('moe-demo', 'moe-demo') }; expected = 'CONFIG_INVALID' },
  @{ name = 'inline key refused'; change = @{ apiKey = 'synthetic-not-accepted' }; expected = 'CONFIG_INVALID' },
  @{ name = 'false default refused'; change = @{ setDefault = $false }; expected = 'CONFIG_INVALID' },
  @{ name = 'string preference refused'; change = @{ setPreferredChannel = 'true' }; expected = 'CONFIG_INVALID' },
  @{ name = 'different provider refused'; change = @{ providerId = 'other' }; expected = 'CONFIG_INVALID' },
  @{ name = 'missing key filename refused'; change = @{ apiKeyFile = $null }; expected = 'KEY_INVALID' }
)
$passed = 0
try {
  foreach ($case in $cases) {
    $value = @{ baseUrl = 'https://setup.invalid/v1'; apiKeyFile = 'client.key' }
    foreach ($name in $case.change.Keys) { $value[$name] = $case.change[$name] }
    [IO.File]::WriteAllText($configPath, ($value | ConvertTo-Json -Depth 4), $utf8)
    [IO.File]::WriteAllText($keyPath, 'synthetic-local-input-check', $utf8)
    $code = 'OK'
    try {
      $result = Read-MinistrySetupInput $configPath
      if ($case.expected -eq 'OK') {
        $seed = $result.Config | ConvertFrom-Json
        if ($seed.providerId -cne 'moe-cloud-gateway' -or $seed.label -cne 'Ministry Online' -or
            $seed.apiKeyFile -cne 'cloud-gateway.key' -or ($seed.models -join ',') -cne 'moe-demo-pro,moe-demo' -or
            $seed.setDefault -ne $true -or $seed.setPreferredChannel -ne $true -or
            $null -ne $seed.PSObject.Properties['apiKey']) { throw 'OUTPUT_CONTRACT_FAILED' }
      }
    } catch { $code = $_.Exception.Message }
    if ($code -ceq $case.expected) { $passed++; Write-Output ('PASS ' + $case.name) }
    else { Write-Output ('FAIL ' + $case.name) }
  }
} finally { [IO.Directory]::Delete($scratch, $true) }
[pscustomobject]@{ status = $(if ($passed -eq $cases.Count) { 'PASS' } else { 'FAIL' }); passed = $passed; failed = ($cases.Count - $passed) } | ConvertTo-Json -Compress
if ($passed -ne $cases.Count) { exit 1 }
