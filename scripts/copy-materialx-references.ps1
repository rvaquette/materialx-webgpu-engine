<#
.SYNOPSIS
Copies Blender Eevee reference images into a flat render directory.
.DESCRIPTION
Finds beauty\blender-eevee-nodes.avif images and uses the material directory
above beauty, relative to SourceDirectory, with separators replaced by "__".
Appends "__", the material directory's .mtlx filename without its extension,
and the fixed suffix "__ref.avif". The beauty directory is not part of the name.
For example, nodes\absval\beauty\blender-eevee-nodes.avif becomes
nodes__absval__absval__ref.avif. Existing reference files are overwritten.
Directories without a .mtlx file are skipped with a warning; multiple .mtlx
files in the same directory cause an error because the reference is ambiguous.
.EXAMPLE
.\scripts\copy-materialx-references.ps1
.EXAMPLE
.\scripts\copy-materialx-references.ps1 -TargetDirectory 'D:\renders\references'
.EXAMPLE
.\scripts\copy-materialx-references.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateNotNullOrEmpty()]
    [string]$SourceDirectory = 'D:\WebGL2\MaterialX\material-samples\materials',

    [ValidateNotNullOrEmpty()]
    [string]$TargetDirectory = 'D:\WebGL2\MaterialX\materialx-webgpu-engine\renders\shaderball\local'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$source = Get-Item -LiteralPath $SourceDirectory
if (-not $source.PSIsContainer -or $source.PSProvider.Name -ne 'FileSystem') {
    throw "SourceDirectory must be a filesystem directory: $SourceDirectory"
}
$sourceRoot = $source.FullName.TrimEnd('\')
$targetRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($TargetDirectory)
$images = @(Get-ChildItem -LiteralPath $source.FullName -Filter 'blender-eevee-nodes.avif' -Recurse -File |
    Where-Object { $_.Directory.Name -eq 'beauty' })
if ($images.Count -eq 0) {
    Write-Warning "No beauty\blender-eevee-nodes.avif images found under $SourceDirectory"
    return
}

$destinations = @{}
$copies = @(foreach ($image in $images) {
    $materialDirectory = $image.Directory.Parent.FullName
    if ($materialDirectory.TrimEnd('\') -eq $sourceRoot) {
        throw "Reference image must be in a material subdirectory: $($image.FullName)"
    }
    $relativeDirectory = $materialDirectory.Substring($sourceRoot.Length + 1)
    $materials = @(Get-ChildItem -LiteralPath $materialDirectory -Filter '*.mtlx' -File)
    if ($materials.Count -eq 0) {
        Write-Warning "Skipping reference without a .mtlx file: $($image.FullName)"
        continue
    }
    if ($materials.Count -gt 1) {
        throw "Multiple .mtlx files found for reference: $($image.FullName)"
    }
    $name = $relativeDirectory.Replace('\', '__') + '__' + $materials[0].BaseName + '__ref.avif'
    if ($destinations.ContainsKey($name)) {
        throw "Duplicate destination '$name' for '$($destinations[$name])' and '$($image.FullName)'"
    }
    $destinations[$name] = $image.FullName
    [pscustomobject]@{
        Source = $image.FullName
        Destination = Join-Path -Path $targetRoot -ChildPath $name
    }
})

if (-not (Test-Path -LiteralPath $targetRoot -PathType Container)) {
    if ($PSCmdlet.ShouldProcess($targetRoot, 'Create target directory')) {
        New-Item -Path $targetRoot -ItemType Directory -Force | Out-Null
    }
}

$copied = 0
foreach ($copy in $copies) {
    if ($PSCmdlet.ShouldProcess($copy.Destination, "Copy reference from '$($copy.Source)'")) {
        Copy-Item -LiteralPath $copy.Source -Destination $copy.Destination -Force
        $copied++
    }
}
Write-Host "Copied $copied of $($copies.Count) eligible reference images to $targetRoot"
