$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object Drawing.Bitmap 256,256
$g=[Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode='AntiAlias'
$g.Clear([Drawing.Color]::FromArgb(20,24,35))
$brush=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(99,230,190))
$g.FillPolygon($brush,[Drawing.Point[]]@([Drawing.Point]::new(83,55),[Drawing.Point]::new(197,128),[Drawing.Point]::new(83,201)))
$pen=New-Object Drawing.Pen ([Drawing.Color]::FromArgb(20,24,35)),16
$g.DrawLine($pen,128,42,128,214)
$memory=New-Object IO.MemoryStream
$bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
$bytes=$memory.ToArray()
$stream=[IO.File]::Create((Join-Path $PSScriptRoot 'Cutline.ico'))
$writer=New-Object IO.BinaryWriter $stream
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$bytes.Length);$writer.Write([uint32]22);$writer.Write($bytes)
$writer.Dispose();$memory.Dispose();$pen.Dispose();$brush.Dispose();$g.Dispose();$bitmap.Dispose()
