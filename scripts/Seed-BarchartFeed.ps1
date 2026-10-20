<#
.SYNOPSIS
    Loads BarChart vendor payloads into the Origination database through the ingestion API.

.DESCRIPTION
    A hands-on alternative to the scheduled data pipeline, for seeding an environment, back-filling,
    or re-running a load. It calls the same endpoints the pipeline uses, so it exercises the real code
    path rather than writing to tables directly.

    Two ways to supply quotes:
      * -QuotesPath      : post vendor quote responses you already have on disk.
      * -BarchartApiKey  : the script asks the API which symbols to quote, calls BarChart itself for
                           each batch, and posts the responses back.

.PARAMETER Token
    Bearer token for the Origination API. The Azure CLI is not a consented client for this API, so get
    one from the browser instead:
      1. Sign in to the Origination app (locally or in dev).
      2. F12 -> Application -> Session Storage -> find the MSAL entry whose target is the API scope
         (".../Origination.Application.Dev") and copy its "secret" value.
    Tokens last about an hour, which is ample for a bulk load. Your account needs the Admin role.

.PARAMETER ApiBase
    Base URL of the Origination API. Defaults to a locally running API, which still writes to the dev
    database. Point it at the deployed dev host to test over the wire.

.PARAMETER InstrumentsPath
    A vendor getGrainInstruments JSON file, or a folder of them (one per page). Posted in name order.

.PARAMETER QuotesPath
    A vendor getQuote JSON file, or a folder of them.

.PARAMETER BarchartApiKey
    Vendor API key. When supplied, the script fetches quotes itself for every symbol batch. Never
    logged and never written to disk.

.PARAMETER BarchartQuoteUrl
    Vendor quote endpoint. VERIFY THIS against your account's documentation before relying on it.

.PARAMETER SnapshotDate
    Business date for the day's price history. Defaults to today, Central time (the API's own default).

.PARAMETER SkipApplyBids
    Load data but don't publish prices onto the Bid Sheet.

.EXAMPLE
    # Seed the catalog from files, then let the script fetch and post quotes itself.
    .\Seed-BarchartFeed.ps1 -Token $t -InstrumentsPath .\barchart-json\ -BarchartApiKey $key

.EXAMPLE
    # Post payloads someone else captured, against the deployed dev API.
    .\Seed-BarchartFeed.ps1 -Token $t -ApiBase https://<dev-host> `
        -InstrumentsPath .\instruments\ -QuotesPath .\quotes\

.NOTES
    Every endpoint is safe to re-run: loads update rather than duplicate, and a same-day quote load
    replaces that day's history. A failed run can simply be run again.

    Vendor calls count against a 250,000/month cap shared by ALL environments, so keep the scope of a
    seed deliberate rather than pulling nationally.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Token,
    [string] $ApiBase = 'http://localhost:5000',
    [string] $InstrumentsPath,
    [string] $QuotesPath,
    [string] $BarchartApiKey,
    [string] $BarchartQuoteUrl = 'https://ondemand.websol.barchart.com/getQuote.json',
    [string] $SnapshotDate,
    [switch] $SkipApplyBids
)

$ErrorActionPreference = 'Stop'
$ingest = "$($ApiBase.TrimEnd('/'))/api/barchart-ingest"
$headers = @{ Authorization = "Bearer $Token"; 'X-Correlation-Id' = "seed-$(Get-Random)" }

function Get-JsonFiles([string] $Path) {
    if (-not $Path) { return @() }
    if (-not (Test-Path $Path)) { throw "Path not found: $Path" }
    if ((Get-Item $Path).PSIsContainer) {
        return Get-ChildItem -Path $Path -Filter *.json | Sort-Object Name
    }
    return @(Get-Item $Path)
}

function Invoke-Ingest([string] $Route, [string] $Body, [string] $Method = 'POST') {
    $uri = "$ingest/$Route"
    try {
        if ($Body) {
            return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers `
                -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($Body))
        }
        return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers
    }
    catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 401) { throw "401 from $Route - the token is missing, expired, or lacks the Admin role." }
        if ($status -eq 403) { throw "403 from $Route - authenticated but not permitted; your account needs the Admin role." }
        # Surface the API's error envelope, which carries a traceId that ties to the server logs.
        $detail = ''
        try { $detail = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
        throw "$status from $Route. $detail"
    }
}

Write-Host "BarChart seed -> $ingest" -ForegroundColor Cyan

# ── Instruments (the location/bid catalog) ───────────────────────────────────
$instrumentFiles = Get-JsonFiles $InstrumentsPath
if ($instrumentFiles.Count -gt 0) {
    Write-Host "`nLoading $($instrumentFiles.Count) instrument payload(s)..." -ForegroundColor Cyan
    $totalRows = 0
    foreach ($file in $instrumentFiles) {
        $body = Get-Content -Path $file.FullName -Raw
        $result = Invoke-Ingest 'instruments' $body
        $totalRows += $result.rowsLoaded
        Write-Host ("  {0,-45} {1,6} rows" -f $file.Name, $result.rowsLoaded)
    }
    Write-Host "  catalog rows loaded: $totalRows" -ForegroundColor Green
}

# ── Quotes from files ────────────────────────────────────────────────────────
$quoteRoute = if ($SnapshotDate) { "quotes?snapshotDate=$SnapshotDate" } else { 'quotes' }
$quoteFiles = Get-JsonFiles $QuotesPath
if ($quoteFiles.Count -gt 0) {
    Write-Host "`nLoading $($quoteFiles.Count) quote payload(s)..." -ForegroundColor Cyan
    $upserted = 0; $unknown = 0
    foreach ($file in $quoteFiles) {
        $body = Get-Content -Path $file.FullName -Raw
        $result = Invoke-Ingest $quoteRoute $body
        $upserted += $result.quotesUpserted; $unknown += $result.unknownSymbolCount
        Write-Host ("  {0,-45} {1,6} quotes" -f $file.Name, $result.quotesUpserted)
    }
    Write-Host "  quotes upserted: $upserted (unknown symbols skipped: $unknown)" -ForegroundColor Green
    if ($unknown -gt 0) {
        Write-Warning "$unknown quote(s) referenced symbols missing from the catalog - load instruments first."
    }
}

# ── Quotes fetched from the vendor, batch by batch ───────────────────────────
if ($BarchartApiKey) {
    Write-Host "`nAsking the API which symbols to quote..." -ForegroundColor Cyan
    $batches = Invoke-Ingest 'quote-batches?batchSize=100' $null 'GET'
    if (-not $batches) {
        Write-Warning "No symbols to quote - is the catalog loaded?"
    }
    else {
        Write-Host "  $($batches.Count) batch(es) to fetch" -ForegroundColor Cyan
        $upserted = 0; $unknown = 0; $failed = 0
        foreach ($batch in $batches) {
            $uri = "$BarchartQuoteUrl`?apikey=$BarchartApiKey&symbols=$($batch.symbolsCsv)"
            try {
                # Vendor response is forwarded verbatim; -Depth keeps large payloads intact.
                $vendor = Invoke-RestMethod -Uri $uri -Method GET
                $result = Invoke-Ingest $quoteRoute ($vendor | ConvertTo-Json -Depth 20 -Compress)
                $upserted += $result.quotesUpserted; $unknown += $result.unknownSymbolCount
                Write-Host ("  batch {0,-4} {1,6} symbols -> {2,6} quotes" -f $batch.batchNumber, $batch.symbolCount, $result.quotesUpserted)
            }
            catch {
                # One bad batch shouldn't abandon the rest; re-running the script retries it safely.
                $failed++
                Write-Warning "  batch $($batch.batchNumber) failed: $($_.Exception.Message)"
            }
        }
        Write-Host "  quotes upserted: $upserted (unknown skipped: $unknown, failed batches: $failed)" -ForegroundColor Green
    }
}

# ── Publish onto the Bid Sheet ───────────────────────────────────────────────
if (-not $SkipApplyBids) {
    Write-Host "`nPublishing prices onto the Bid Sheet..." -ForegroundColor Cyan
    $applied = Invoke-Ingest 'apply-bids?instrumentType=bidCash' $null
    Write-Host "  bid cells written or pruned: $($applied.rowsAffected)" -ForegroundColor Green
    if ($applied.rowsAffected -eq 0) {
        Write-Warning "Nothing was published. Usual causes: dbo.BarchartCommodityMap is empty (needs the vendor-name -> Scoular-code rows), or no Bid Sheet location has a BarchartLocationKey yet."
    }
}

# ── Usage against the vendor cap ─────────────────────────────────────────────
$budget = Invoke-Ingest 'budget?monthlyCap=250000' $null 'GET'
Write-Host "`nIngest calls month-to-date: $($budget.monthToDateCalls) (remaining $($budget.remainingCalls))" -ForegroundColor Cyan
if ($budget.abortRecommended) { Write-Warning "Usage has passed 80% of the monthly cap." }

Write-Host "`nDone." -ForegroundColor Green
