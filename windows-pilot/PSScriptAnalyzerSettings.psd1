@{
    # CLWX-83: lint gate for the windows-pilot PowerShell surface.
    #
    # The pilot fleet runs Windows PowerShell 5.1 (quoting/BOM classes have
    # burned this project 5+ times — see docs/WINDOWS_PROBLEMS_ATLAS.md and
    # the PowerShell-BOM regression). Dev boxes run PowerShell 7. Every
    # script must PARSE on both, so PSUseCompatibleSyntax targets both.
    #
    # Consumed by scripts/lint-powershell.mjs (pnpm lint:ps). The gate fails
    # on Error, ParseError, and any PSUseCompatibleSyntax finding; Warning
    # and Information findings are reported as counts only.
    IncludeDefaultRules = $true
    Rules               = @{
        PSUseCompatibleSyntax = @{
            Enable         = $true
            TargetVersions = @('5.1', '7.0')
        }
    }
}
