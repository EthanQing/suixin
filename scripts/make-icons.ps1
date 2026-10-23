$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null

function New-TodoIcon([string]$Destination, [int[]]$Sizes) {
    $images = @()
    foreach ($size in $Sizes) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $black = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 22, 22, 22))
        $graphics.FillEllipse($black, $size * 0.04, $size * 0.04, $size * 0.92, $size * 0.92)
        $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, $size * 0.085)
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $points = [System.Drawing.PointF[]]@(
            [System.Drawing.PointF]::new($size * 0.28, $size * 0.51),
            [System.Drawing.PointF]::new($size * 0.44, $size * 0.67),
            [System.Drawing.PointF]::new($size * 0.73, $size * 0.35)
        )
        $graphics.DrawLines($pen, $points)
        $stream = [System.IO.MemoryStream]::new()
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $images += ,$stream.ToArray()
        $stream.Dispose(); $pen.Dispose(); $black.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    }
    $file = [System.IO.File]::Create($Destination)
    $writer = [System.IO.BinaryWriter]::new($file)
    try {
        $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$Sizes.Length)
        $offset = 6 + 16 * $Sizes.Length
        for ($i = 0; $i -lt $Sizes.Length; $i++) {
            $dimension = if ($Sizes[$i] -eq 256) { 0 } else { $Sizes[$i] }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([UInt16]1); $writer.Write([UInt16]32)
            $writer.Write([UInt32]$images[$i].Length); $writer.Write([UInt32]$offset)
            $offset += $images[$i].Length
        }
        foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
    } finally { $writer.Dispose(); $file.Dispose() }
}

New-TodoIcon (Join-Path $assetDirectory 'icon.ico') @(16, 24, 32, 48, 64, 128, 256)
New-TodoIcon (Join-Path $assetDirectory 'tray.ico') @(16, 20, 24, 32, 48)
Write-Output 'Icons generated.'
