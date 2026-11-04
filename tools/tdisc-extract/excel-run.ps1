param(
  [Parameter(Mandatory)][string]$Workbook,
  [Parameter(Mandatory)][string]$CasesJson
)
# Runs T-DISC test passes through the USDA workbook's own formulas and prints the results as JSON.
# Called by golden.mjs. Excel is started hidden with macros forced off, the workbook is opened
# read-only without updating links, and it is closed without saving.
$ErrorActionPreference = 'Stop'

$cases = Get-Content -Raw -LiteralPath $CasesJson | ConvertFrom-Json
$windows = [ordered]@{ Field_Preparation = 11; Before_Planting = 12; Planting = 13; After_Planting = 14; Harvest = 15 }

$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $xl.EnableEvents = $false
  $xl.AutomationSecurity = 3   # msoAutomationSecurityForceDisable: no macros run
  $wb = $xl.Workbooks.Open($Workbook, 0, $true)
  try {
    $ws = $wb.Worksheets.Item('User Input')
    $results = @()
    foreach ($c in $cases) {
      # Management unit 1 takes up to 20 passes in C9:D28 (the defined name Input1).
      $ws.Range('C9:D28').ClearContents() | Out-Null
      for ($i = 0; $i -lt $c.passes.Count; $i++) {
        $ws.Range("C$(9 + $i)").Value2 = [string]$c.passes[$i].window
        $ws.Range("D$(9 + $i)").Value2 = [string]$c.passes[$i].workbookName
      }
      $xl.CalculateFull()
      $windowResults = [ordered]@{}
      foreach ($w in $windows.Keys) {
        $row = $windows[$w]
        $index = $ws.Range("J$row").Value2
        $windowResults[$w] = [pscustomobject]@{
          index = if ($index -is [double]) { $index } else { $null }
          designation = if ([string]$ws.Range("K$row").Value2) { [string]$ws.Range("K$row").Value2 } else { $null }
        }
      }
      $results += [pscustomobject]@{
        name = $c.name
        expected = [pscustomobject]@{
          rating = $ws.Range('J7').Value2
          designation = [string]$ws.Range('J8').Value2
          windows = [pscustomobject]$windowResults
        }
      }
    }
    ConvertTo-Json -InputObject $results -Depth 5 -Compress
  } finally {
    $wb.Close($false)
  }
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
