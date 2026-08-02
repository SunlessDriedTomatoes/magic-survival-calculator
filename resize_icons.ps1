Add-Type -AssemblyName System.Drawing

$srcDir = "magicsurvival\export\sprites"
$dstDir = "magicsurvival\export\icons_resized"
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null

$maxDim = 64

$lines = Get-Content "unique_icon_files.txt"
$count = 0
foreach ($name in $lines) {
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $srcPath = Join-Path $srcDir $name
    $dstPath = Join-Path $dstDir $name
    if (-not (Test-Path $srcPath)) { continue }

    $src = [System.Drawing.Image]::FromFile((Resolve-Path $srcPath))
    $scale = [Math]::Min(1.0, $maxDim / [Math]::Max($src.Width, $src.Height))
    $w = [Math]::Max(1, [int]($src.Width * $scale))
    $h = [Math]::Max(1, [int]($src.Height * $scale))

    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $w, $h)
    $bmp.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose(); $bmp.Dispose(); $src.Dispose()
    $count++
}
Write-Output "Resized $count icons to $dstDir"
