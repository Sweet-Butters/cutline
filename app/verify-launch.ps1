$ErrorActionPreference='Stop'
$bundle=Join-Path $PSScriptRoot 'build/Cutline'
$exe=Join-Path $bundle 'VSCodium.exe'
$env:TEMP=Join-Path $PSScriptRoot 'temp';$env:TMP=$env:TEMP
$existing=@(Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object Path -eq $exe)
if($existing.Count){throw 'Close this bundle before verification; existing processes will not be terminated.'}
New-Item -ItemType Directory -Force "$PSScriptRoot/screenshots" | Out-Null
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CutlineWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd,int command);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
}
'@
[CutlineWindow]::SetProcessDPIAware() | Out-Null
$started=Get-Date
try {
 # This window is intentionally visible: it is the app under desktop verification.
 Start-Process -FilePath "$bundle/Cutline.exe"
 $deadline=(Get-Date).AddMinutes(4)
 $window=$null;$canplay=$null
 do {
  Start-Sleep -Seconds 2
  $window=Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.MainWindowTitle -like 'Cutline*' } | Select-Object -First 1
  $logs=Get-ChildItem "$bundle/data/user-data/logs" -Filter '*Cutline*' -File -Recurse -ErrorAction SilentlyContinue | Where-Object LastWriteTime -ge $started
  $canplay=$logs | Select-String '"event":"canplay"' | Select-Object -First 1
 }until(($window -and $canplay) -or (Get-Date) -ge $deadline)
 if(!$window){throw 'No Cutline-titled window appeared'}
 if(!$canplay){throw 'No real playback canplay event in the installed extension log'}
 [CutlineWindow]::ShowWindow($window.MainWindowHandle,9) | Out-Null
 # Foreground activation alone can be denied by Windows. Temporarily keep our
 # own window on top and capture the monitor containing it, not a different one.
 $area=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
 [CutlineWindow]::SetWindowPos($window.MainWindowHandle,[IntPtr](-1),($area.X+20),($area.Y+20),($area.Width-40),($area.Height-40),0x40) | Out-Null
 [CutlineWindow]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
 Start-Sleep -Seconds 3
 $screen=[Windows.Forms.Screen]::FromHandle($window.MainWindowHandle).Bounds
 $bitmap=New-Object Drawing.Bitmap $screen.Width,$screen.Height
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 try {
  $graphics.CopyFromScreen($screen.Location,[Drawing.Point]::Empty,$screen.Size)
  $bitmap.Save("$PSScriptRoot/screenshots/cutline-launch.png",[Drawing.Imaging.ImageFormat]::Png)
 }finally{$graphics.Dispose();$bitmap.Dispose()}
 @{title=$window.MainWindowTitle;pid=$window.Id;executable=$window.Path;started=$started.ToString('o');canplay=$canplay.Line;log=$canplay.Path;screenshot='app/screenshots/cutline-launch.png'} | ConvertTo-Json | Set-Content "$PSScriptRoot/screenshots/launch-report.json" -Encoding UTF8
 Get-Content "$PSScriptRoot/screenshots/launch-report.json"
}finally{
 # No global taskkill: only the bundle that was absent before this launch.
 $owned=@(Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.StartTime -ge $started })
 foreach($process in $owned | Where-Object MainWindowHandle -ne 0) {
  [void]$process.CloseMainWindow()
  [void]$process.WaitForExit(10000)
 }
 foreach($process in $owned) {
  if(!$process.HasExited){$process.Kill();[void]$process.WaitForExit(10000)}
 }
}
