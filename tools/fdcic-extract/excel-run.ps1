param(
  [Parameter(Mandatory)][string]$Workbook,
  [Parameter(Mandatory)][string]$CasesJson
)
# Runs FD-CIC test-case inputs through the USDA workbook's own formulas and prints the results as JSON.
# Called by golden.mjs. Excel is started hidden with macros forced off, the workbook is opened
# read-only without updating links, and it is closed without saving.
$ErrorActionPreference = 'Stop'

$cases = Get-Content -Raw -LiteralPath $CasesJson | ConvertFrom-Json
$outputs = [ordered]@{
  yieldForCi = 'C16'; nFertilizer = 'C70'; soilCarbon = 'C72'; directN2o = 'C79'; indirectN2o = 'C80'
  onFarmEnergy = 'C82'; otherChemicals = 'C83'; ureaLime = 'C84'; ci = 'C68'; nationalAverage = 'M68'; changeFraction = 'C98'
}
$errors = @{ -2146826288 = '#NULL!'; -2146826281 = '#DIV/0!'; -2146826273 = '#VALUE!'; -2146826265 = '#REF!'
             -2146826259 = '#NAME?'; -2146826252 = '#NUM!'; -2146826246 = '#N/A' }

function SetCell($ws, [string]$address, $value) { $ws.Range($address).Formula = [string]$value }

$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $xl.EnableEvents = $false
  $xl.AutomationSecurity = 3   # msoAutomationSecurityForceDisable: no macros run
  $wb = $xl.Workbooks.Open($Workbook, 0, $true)
  try {
    $ws = $wb.Worksheets.Item('Crop Inputs')
    $results = @()
    foreach ($c in $cases) {
      SetCell $ws 'C4'  $c.crop
      SetCell $ws 'C10' $c.state
      SetCell $ws 'C11' $c.county
      SetCell $ws 'C14' $c.actualYield
      SetCell $ws 'C15' $c.expectedYield
      SetCell $ws 'C18' $c.syntheticN
      SetCell $ws 'C29' $c.coverCrop
      SetCell $ws 'C31' $c.tillage
      SetCell $ws 'C33' $c.niFraction
      $rows = @(@('C37', 'C38'), @('C40', 'C41'), @('C43', 'C44'))
      for ($i = 0; $i -lt 3; $i++) {
        $m = if ($c.manure -and $i -lt $c.manure.Count) { $c.manure[$i] } else { $null }
        SetCell $ws $rows[$i][0] $(if ($m) { $m.amount } else { 0 })
        SetCell $ws $rows[$i][1] $(if ($m) { $m.nContent } else { 0 })
      }
      $xl.CalculateFull()
      $ci = $ws.Range('C68').Value2
      if ($ci -is [int]) {
        $results += [pscustomobject]@{ name = $c.name; expected = [pscustomobject]@{ error = $errors[$ci] } }
        continue
      }
      $expected = [ordered]@{}
      foreach ($k in $outputs.Keys) {
        $v = $ws.Range($outputs[$k]).Value2
        $expected[$k] = if ($v -is [int]) { $errors[$v] } else { $v }
      }
      $results += [pscustomobject]@{ name = $c.name; expected = [pscustomobject]$expected }
    }
    ConvertTo-Json -InputObject $results -Depth 4 -Compress
  } finally {
    $wb.Close($false)
  }
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
