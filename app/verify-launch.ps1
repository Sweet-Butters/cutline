param([string]$Project,[string]$Screenshot='cutline-launch-2.png',[switch]$AllowPreparing)
$ErrorActionPreference='Stop'
$bundle=Join-Path $PSScriptRoot 'build/Cutline'
$exe=Join-Path $bundle 'VSCodium.exe'
$env:TEMP=Join-Path $PSScriptRoot 'temp';$env:TMP=$env:TEMP
# Keep verification writes in this repository, while exercising the default-copy branch.
$env:CUTLINE_DOCUMENTS=Join-Path (Split-Path $PSScriptRoot -Parent) '.test-data/Documents'
$env:CUTLINE_CACHE_ROOT=Join-Path $PSScriptRoot 'temp/verification-cache'
$existing=@(Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object Path -eq $exe)
if($existing.Count){throw 'Close this bundle before verification; existing processes will not be terminated.'}
New-Item -ItemType Directory -Force "$PSScriptRoot/screenshots" | Out-Null
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CutlineWindow {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
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
 if($Project){Start-Process -FilePath "$bundle/Cutline.exe" -ArgumentList ('"'+$Project+'"')}
 else{Start-Process -FilePath "$bundle/Cutline.exe"}
 $deadline=(Get-Date).AddMinutes(4)
 $window=$null;$canplay=$null;$comparison=$null
 do {
  Start-Sleep -Seconds 2
  $window=Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.MainWindowTitle -like 'Cutline*' } | Select-Object -First 1
  $logs=Get-ChildItem "$bundle/data/user-data/logs" -Filter '*Cutline*' -File -Recurse -ErrorAction SilentlyContinue | Where-Object LastWriteTime -ge $started
  $canplay=$logs | Select-String '"event":"canplay"' | Select-Object -First 1
  $comparison=$logs | Select-String '"type":"referencesApplied","items":\[{' | Select-Object -First 1
 }until(($window -and ($canplay -or ($AllowPreparing -and $comparison))) -or (Get-Date) -ge $deadline)
 if(!$window){throw 'No Cutline-titled window appeared'}
 if(!$canplay -and !$AllowPreparing){throw 'No real playback canplay event in the installed extension log'}
 if($AllowPreparing -and !$canplay){Start-Sleep -Seconds 25}
 [CutlineWindow]::ShowWindow($window.MainWindowHandle,9) | Out-Null
 # Foreground activation alone can be denied by Windows. Temporarily keep our
 # own window on top and capture the monitor containing it, not a different one.
 $area=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
 [CutlineWindow]::SetWindowPos($window.MainWindowHandle,[IntPtr](-1),($area.X+20),($area.Y+20),($area.Width-40),($area.Height-40),0x40) | Out-Null
 [CutlineWindow]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
 Start-Sleep -Seconds 3
 $checklist=$logs | Select-String '"type":"checklistApplied"' | Select-Object -Last 1
 $proxyWorkers=@(Get-CimInstance Win32_Process -Filter "Name = 'ffmpeg.exe'" | Where-Object {$_.CommandLine -like '*verification-cache*' -and $_.CreationDate -ge $started})
 $rect=New-Object CutlineWindow+Rect
 $origin=New-Object CutlineWindow+Point
 if(![CutlineWindow]::GetClientRect($window.MainWindowHandle,[ref]$rect) -or ![CutlineWindow]::ClientToScreen($window.MainWindowHandle,[ref]$origin)){throw "Cannot locate app client area"}
 $screen=New-Object Drawing.Rectangle($origin.X,$origin.Y,($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
 $bitmap=New-Object Drawing.Bitmap $screen.Width,$screen.Height
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 try {
  $graphics.CopyFromScreen($screen.Location,[Drawing.Point]::Empty,$screen.Size)
  $bitmap.Save("$PSScriptRoot/screenshots/$Screenshot",[Drawing.Imaging.ImageFormat]::Png)
 }finally{$graphics.Dispose();$bitmap.Dispose()}
 @{title=$window.MainWindowTitle;pid=$window.Id;executable=$window.Path;started=$started.ToString('o');canplay=$canplay.Line;comparison=$comparison.Line;checklist=$checklist.Line;cache=$env:CUTLINE_CACHE_ROOT;proxyWorkerCount=$proxyWorkers.Count;screenshot="app/screenshots/$Screenshot"} | ConvertTo-Json | Set-Content "$PSScriptRoot/screenshots/$Screenshot.json" -Encoding UTF8
 Get-Content "$PSScriptRoot/screenshots/$Screenshot.json"
}finally{
 # No global taskkill: only the bundle that was absent before this launch.
 $owned=@(Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.StartTime -ge $started })
 # Include only ffmpeg descendants of this launch, before parents exit.
 $tree=@(Get-CimInstance Win32_Process)
 $ids=[Collections.Generic.HashSet[int]]::new()
 foreach($p in $owned){[void]$ids.Add($p.Id)}
 do {$added=$false;foreach($p in $tree){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$added=$true}}}while($added)
 $workers=@($tree | Where-Object {$_.Name -eq 'ffmpeg.exe' -and $ids.Contains([int]$_.ProcessId)})
 foreach($process in $owned | Where-Object MainWindowHandle -ne 0) {
  [void]$process.CloseMainWindow()
  [void]$process.WaitForExit(10000)
 }
 foreach($process in $owned) {
  if(!$process.HasExited){$process.Kill();[void]$process.WaitForExit(10000)}
 }
 foreach($worker in $workers){$p=Get-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue;if($p -and $p.StartTime -ge $started){Stop-Process -Id $p.Id}}
 # A renderer can be spawned during shutdown; reap only late children of our bundle.
 for($attempt=0;$attempt -lt 3;$attempt++){
  $late=@(Get-Process VSCodium -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe -and $_.StartTime -ge $started})
  foreach($p in $late){Stop-Process -Id $p.Id -ErrorAction SilentlyContinue}
  if(!$late.Count){break}
  Start-Sleep -Milliseconds 500
 }
}
