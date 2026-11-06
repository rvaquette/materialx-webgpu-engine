[CmdletBinding()]
param()

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
foreach ($file in $files) {
    $index++
    $relative = $file.FullName.Substring($scenesRoot.Length + 1)
    $relativeDirectory = [IO.Path]::GetDirectoryName($relative)
    $outParent = if ($relativeDirectory) { Join-Path $outputRoot $relativeDirectory } else { $outputRoot }
    $outDir = Join-Path $outParent ([IO.Path]::GetFileNameWithoutExtension($file.Name))

    Write-Host "`n[$index/$($files.Count)] Compiling: $relative" -ForegroundColor Cyan
    & node $exportScript --entry $file.FullName --out $outDir
    if ($LASTEXITCODE -ne 0) {
        throw "Compilation failed: $relative (exit code $LASTEXITCODE)"
    }
}

Write-Host "`nExported $($files.Count) scenes." -ForegroundColor Green
