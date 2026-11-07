[CmdletBinding()]
param(
    [switch]$SkipExisting,
    [ValidateRange(1, 22)]
    [int]$CompressionLevel = 22,
    [ValidateRange(1, 2147483647)]
    [int]$TimeoutMs = 1800000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$scenesRoot = Join-Path $root 'scenes'
$outputRoot = Join-Path $scenesRoot 'compiled'
$playgroundRoot = Join-Path $scenesRoot 'OpenPBRShaderPlayground'
$exportScript = Join-Path $PSScriptRoot 'export-scene.mjs'

$files = @(Get-ChildItem -LiteralPath $scenesRoot |
    Where-Object { $_.FullName -ne $outputRoot } |
    ForEach-Object {
        if ($_.PSIsContainer) {
            Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter '*.usda'
        } elseif ($_.Extension -ieq '.usda') {
            $_
        }
    } |
    Where-Object {
        -not $_.FullName.StartsWith(
            $playgroundRoot + '\',
            [StringComparison]::OrdinalIgnoreCase
        ) -or $_.Name -like '*_grp.usda'
    } |
    Sort-Object FullName)

if ($files.Count -eq 0) {
    throw "No USDA files found under $scenesRoot"
}

$index = 0
$exported = 0
$skipped = 0
foreach ($file in $files) {
    $index++
    $relative = $file.FullName.Substring($scenesRoot.Length + 1)
    $relativeDirectory = [IO.Path]::GetDirectoryName($relative)
    $outParent = if ($relativeDirectory) { Join-Path $outputRoot $relativeDirectory } else { $outputRoot }
    $outDir = Join-Path $outParent ([IO.Path]::GetFileNameWithoutExtension($file.Name))

    if ($SkipExisting -and (Test-Path -LiteralPath (Join-Path $outDir 'scene.json') -PathType Leaf)) {
        $skipped++
        Write-Host "`n[$index/$($files.Count)] Already exported: $relative" -ForegroundColor Yellow
        continue
    }

    Write-Host "`n[$index/$($files.Count)] Compiling: $relative" -ForegroundColor Cyan
    & node $exportScript --entry $file.FullName --out $outDir --compression-level $CompressionLevel --timeout $TimeoutMs
    if ($LASTEXITCODE -ne 0) {
        throw "Compilation failed: $relative (exit code $LASTEXITCODE)"
    }
    $exported++
}

Write-Host "`nExported $exported scenes; skipped $skipped existing scenes." -ForegroundColor Green
