<#
.SYNOPSIS
    Exports a live BarChart catalog and its current quotes as vendor-shaped JSON pages.

.DESCRIPTION
    Rebuilds what the vendor sent us from what we stored, so another environment can be seeded
    without calling BarChart again. The output is the same shape getGrainInstruments and getQuote
    return, so it feeds straight into Seed-BarchartFeed.ps1 and therefore through the real ingestion
    endpoints -- parsing, symbol anatomy, IsTest detection and all. That matters: loading an
    environment by copying rows between databases would put data there that never passed through the
    code the environment is supposed to be testing.

    Typical use is seeding QA from Dev while the scheduled pipeline is still pointed elsewhere:

        ./Export-BarchartFeedSnapshot.ps1 -OutputPath ./barchart-snapshot
        ./Seed-BarchartFeed.ps1 -Token <qa token> -ApiBase https://<qa host> `
            -InstrumentsPath ./barchart-snapshot/instruments `
            -QuotesPath      ./barchart-snapshot/quotes

    Then seed dbo.BarchartCommodityMap (Seed-BarchartCommodityMap.sql) and call apply-bids.

.PARAMETER SourceConnectionString
    Database to read from. Defaults to Dev. Note there is no Authentication keyword: see -AccessToken.

.PARAMETER AccessToken
    Entra token for the database. Left empty the script fetches one from your Azure CLI session, so
    "az login" is normally all the setup needed.

.PARAMETER OutputPath
    Folder for the exported pages. Created if missing. Existing page files are removed first so a
    re-run cannot leave a stale page behind for the seeder to post.

.PARAMETER PageSize
    Rows per file. The ingestion endpoints cap a request at 10 MB. Measured against the live Dev
    catalog, instruments run about 0.57 KB each and quotes about 0.31 KB, so the 5,000 default lands
    near 2.8 MB. The script warns if a page exceeds 8 MB.

.PARAMETER IncludeInactive
    Export deactivated instruments too. Off by default -- a fresh environment wants the live book.

.EXAMPLE
    ./Export-BarchartFeedSnapshot.ps1 -OutputPath C:\temp\barchart -PageSize 4000
#>
[CmdletBinding()]
param(
    [string] $SourceConnectionString =
        'Server=tcp:azrscosqld01.database.windows.net,1433;Database=Origination;Encrypt=true;',
    [Parameter(Mandatory)] [string] $OutputPath,
    [int]    $PageSize = 5000,
    [switch] $IncludeInactive,
    [string] $AccessToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The column list mirrors the OPENJSON contract in BarchartIngestRepository exactly. If a field is
# added there, add it here or a reseeded environment will quietly lose it.
$instrumentSelect = @'
SELECT
    symbol            = i.Symbol,
    symbolDescription = i.SymbolDescription,
    elevator          = i.Elevator,
    commodity         = i.Commodity,
    underlyingFuture  = i.UnderlyingFuture,
    deliveryStart     = CASE WHEN i.DeliveryStart IS NULL THEN NULL
                             ELSE CONVERT(nvarchar(30), i.DeliveryStart, 127) + N'Z' END,
    deliveryEnd       = CASE WHEN i.DeliveryEnd IS NULL THEN NULL
                             ELSE CONVERT(nvarchar(30), i.DeliveryEnd, 127) + N'Z' END,
    location          = i.LocationName,
    facilityType      = i.FacilityType,
    phone             = i.Phone,
    website           = i.Website,
    address           = i.Address,
    city              = i.City,
    state             = i.State,
    zipCode           = i.ZipCode,
    longitude         = CONVERT(nvarchar(40), i.Longitude),
    latitude          = CONVERT(nvarchar(40), i.Latitude),
    county            = i.County,
    countyFipsCode    = i.CountyFips,
    stateFipsCode     = i.StateFips
FROM dbo.BarchartInstrument AS i
WHERE (@includeInactive = 1 OR i.IsActive = 1)
ORDER BY i.Symbol
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
FOR JSON PATH
'@

# Quotes carry a per-row vendor status; emitting 200 keeps every row loadable, matching what the
# vendor sent for the rows we actually stored.
$quoteSelect = @'
SELECT
    symbol          = q.Symbol,
    lastPrice       = CONVERT(nvarchar(40), q.LastPrice),
    netChange       = CONVERT(nvarchar(40), q.NetChange),
    percentChange   = CONVERT(nvarchar(40), q.PercentChange),
    [open]          = CONVERT(nvarchar(40), q.OpenPrice),
    high            = CONVERT(nvarchar(40), q.HighPrice),
    low             = CONVERT(nvarchar(40), q.LowPrice),
    [close]         = CONVERT(nvarchar(40), q.ClosePrice),
    unitCode        = q.UnitCode,
    dayCode         = q.DayCode,
    mode            = q.QuoteMode,
    flag            = q.QuoteFlag,
    tradeTimestamp  = CASE WHEN q.TradeTimestamp IS NULL THEN NULL
                           ELSE CONVERT(nvarchar(30), q.TradeTimestamp, 127) + N'Z' END,
    serverTimestamp = CASE WHEN q.ServerTimestamp IS NULL THEN NULL
                           ELSE CONVERT(nvarchar(30), q.ServerTimestamp, 127) + N'Z' END,
    code            = 200
FROM dbo.BarchartCurrentQuote AS q
INNER JOIN dbo.BarchartInstrument AS i ON i.Symbol = q.Symbol
WHERE (@includeInactive = 1 OR i.IsActive = 1)
ORDER BY q.Symbol
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
FOR JSON PATH
'@

function Invoke-Scalar {
    param([System.Data.SqlClient.SqlConnection] $Connection, [string] $Sql, [hashtable] $Parameters = @{})

    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    $command.CommandTimeout = 600
    foreach ($key in $Parameters.Keys) {
        $null = $command.Parameters.AddWithValue($key, $Parameters[$key])
    }
    try {
        # FOR JSON streams across rows when the document is large, so concatenate rather than
        # ExecuteScalar -- which would silently return only the first 2,033-character chunk.
        $reader = $command.ExecuteReader()
        $builder = [System.Text.StringBuilder]::new()
        while ($reader.Read()) { $null = $builder.Append($reader.GetString(0)) }
        $reader.Close()
        return $builder.ToString()
    }
    finally { $command.Dispose() }
}

function Export-Pages {
    param(
        [System.Data.SqlClient.SqlConnection] $Connection,
        [string] $Sql, [string] $Folder, [string] $Label, [int] $Total
    )

    if (-not (Test-Path $Folder)) { $null = New-Item -ItemType Directory -Path $Folder -Force }
    Get-ChildItem -Path $Folder -Filter "$Label-*.json" -ErrorAction SilentlyContinue | Remove-Item -Force

    $page = 0
    $written = 0
    for ($offset = 0; $offset -lt $Total; $offset += $PageSize) {
        $page++
        $json = Invoke-Scalar -Connection $Connection -Sql $Sql -Parameters @{
            '@offset'          = $offset
            '@pageSize'        = $PageSize
            '@includeInactive' = [int]$IncludeInactive.IsPresent
        }
        if ([string]::IsNullOrWhiteSpace($json)) { continue }

        $envelope = '{"status":{"code":200},"results":' + $json + '}'
        $file = Join-Path $Folder ('{0}-{1:d4}.json' -f $Label, $page)
        [System.IO.File]::WriteAllText($file, $envelope, [System.Text.UTF8Encoding]::new($false))

        $sizeMb = [math]::Round((Get-Item $file).Length / 1MB, 2)
        $written++
        Write-Host ("  {0}  {1,8:N0} rows  {2,6:N2} MB" -f (Split-Path $file -Leaf),
            [math]::Min($PageSize, $Total - $offset), $sizeMb)
        if ($sizeMb -gt 8) {
            Write-Warning "$file is ${sizeMb} MB -- close to the 10 MB request cap. Lower -PageSize."
        }
    }
    return $written
}

# Windows PowerShell ships System.Data.SqlClient, which has no "Authentication=Active Directory
# Default" support -- that keyword only exists in Microsoft.Data.SqlClient. It does honour an
# AccessToken, so fetch one from the Azure CLI session the developer is already signed in to.
if (-not $AccessToken) {
    Write-Host 'Getting a database access token from the Azure CLI...'
    $AccessToken = (& az account get-access-token --resource 'https://database.windows.net/' --query accessToken -o tsv 2>$null)
    if (-not $AccessToken) {
        throw 'Could not get an access token. Run "az login", or pass -AccessToken explicitly.'
    }
}

$connection = [System.Data.SqlClient.SqlConnection]::new($SourceConnectionString)
$connection.AccessToken = $AccessToken
$connection.Open()
try {
    $filter = if ($IncludeInactive) { '1=1' } else { 'IsActive = 1' }
    $instrumentCount = [int](Invoke-Scalar -Connection $connection `
        -Sql "SELECT CONVERT(nvarchar(20), COUNT(*)) FROM dbo.BarchartInstrument WHERE $filter")
    $quoteCountSql = 'SELECT CONVERT(nvarchar(20), COUNT(*)) FROM dbo.BarchartCurrentQuote q ' +
                     'INNER JOIN dbo.BarchartInstrument i ON i.Symbol = q.Symbol WHERE i.' + $filter
    $quoteCount = [int](Invoke-Scalar -Connection $connection -Sql $quoteCountSql)

    Write-Host "Source holds $instrumentCount instruments and $quoteCount quotes."
    Write-Host ''

    Write-Host 'Instruments:'
    $instrumentPages = Export-Pages -Connection $connection -Sql $instrumentSelect `
        -Folder (Join-Path $OutputPath 'instruments') -Label 'instruments' -Total $instrumentCount

    Write-Host ''
    Write-Host 'Quotes:'
    $quotePages = Export-Pages -Connection $connection -Sql $quoteSelect `
        -Folder (Join-Path $OutputPath 'quotes') -Label 'quotes' -Total $quoteCount

    Write-Host ''
    Write-Host "Wrote $instrumentPages instrument page(s) and $quotePages quote page(s) to $OutputPath"
    Write-Host ''
    Write-Host 'Next: post them with Seed-BarchartFeed.ps1, seed dbo.BarchartCommodityMap, then apply-bids.'
}
finally {
    $connection.Close()
    $connection.Dispose()
}
