param([switch]$Clean)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=Split-Path $PSScriptRoot -Parent
$bundle=Join-Path $PSScriptRoot 'build/Cutline'
$downloads=Join-Path $PSScriptRoot 'downloads'
$temp=Join-Path $PSScriptRoot 'temp'
$dist=Join-Path $PSScriptRoot 'dist'
foreach($dir in @($downloads,$temp,$dist)){New-Item -ItemType Directory -Force $dir | Out-Null}
$env:TEMP=$temp;$env:TMP=$temp;$env:npm_config_cache=Join-Path $root '.npm-cache'
function CheckExit($step){if($LASTEXITCODE -ne 0){throw "$step failed: $LASTEXITCODE"}}
if(Test-Path $bundle){
  if(!$Clean){throw 'Bundle already exists. Use -Clean to replace app/build/Cutline (including its demo profile).'}
  $resolved=(Resolve-Path -LiteralPath $bundle).Path
  if($resolved -ne [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build/Cutline'))){throw 'Unexpected build path'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
$version='1.100.33714'
$asset="VSCodium-win32-x64-$version.zip"
$url="https://github.com/VSCodium/vscodium/releases/download/$version/$asset"
$archive=Join-Path $downloads $asset
$checksum="$archive.sha256"
Invoke-WebRequest "$url.sha256" -OutFile $checksum
$published=((Get-Content $checksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$pinned='d820e0a67abdf60e24680488e8e414f4a0b82b8dc050304584d701b298df877c'
if($published -ne $pinned){throw 'Published checksum differs from pinned release checksum'}
if(!(Test-Path $archive)){Invoke-WebRequest $url -OutFile $archive}
if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $published){throw 'VSCodium SHA-256 verification failed'}
Write-Host "Verified official VSCodium $version SHA-256: $published"
New-Item -ItemType Directory -Force $bundle | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($archive,$bundle)
Add-Type -Path "$PSScriptRoot/BrandIcon.cs"
[BrandIcon]::Replace("$bundle/VSCodium.exe","$PSScriptRoot/Cutline.ico")
Copy-Item "$PSScriptRoot/Cutline.ico" "$bundle/resources/app/resources/win32/code.ico" -Force
$productPath="$bundle/resources/app/product.json"
$product=Get-Content $productPath -Raw | ConvertFrom-Json
$product.nameShort='Cutline';$product.nameLong='Cutline';$product.win32AppUserModelId='Cutline.VideoIDE'
$product | ConvertTo-Json -Depth 100 | Set-Content $productPath -Encoding UTF8
Push-Location $root
try { & npm.cmd run package;CheckExit 'VSIX packaging' }finally{Pop-Location}
New-Item -ItemType Directory -Force "$bundle/data/user-data/User","$bundle/data/extensions","$bundle/data/tmp" | Out-Null
$settings=@{
 'window.title'='Cutline - ${rootName}${separator}${activeEditorShort}';'workbench.colorTheme'='Default Dark Modern';
 'workbench.startupEditor'='none';'workbench.tips.enabled'=$false;'workbench.welcomePage.walkthroughs.openOnInstall'=$false;
 'telemetry.telemetryLevel'='off';'update.mode'='none';'extensions.autoUpdate'=$false;'extensions.autoCheckUpdates'=$false;
 'security.workspace.trust.enabled'=$false;'git.openRepositoryInParentFolders'='never';'git.autofetch'=$false;
 'editor.minimap.enabled'=$false;'workbench.activityBar.location'='hidden';'window.commandCenter'=$false;
 'cutline.autoOpenPanel'=$true;'cutline.openTerminal'=$true;'window.titleBarStyle'='native';
 'workbench.panel.defaultLocation'='bottom';'workbench.panel.opensMaximized'='never';
 'files.exclude'=@{'**/.cutline-cache'=$true;'**/.git'=$true;'**/node_modules'=$true;'**/.timeline-*.tmp'=$true}
}
$settings | ConvertTo-Json | Set-Content "$bundle/data/user-data/User/settings.json" -Encoding UTF8
$savedPortable=$env:VSCODE_PORTABLE
try {
 $env:VSCODE_PORTABLE="$bundle/data"
 & "$bundle/bin/codium.cmd" --install-extension "$root/dist/cutline.vsix" --force
 CheckExit 'Portable VSIX install'
}finally{$env:VSCODE_PORTABLE=$savedPortable}
# Copy only the known sample inputs, never caches, exports or personal history.
New-Item -ItemType Directory -Force "$bundle/sample-project","$bundle/tools","$bundle/out" | Out-Null
foreach($item in @('sources','transcripts','timeline.json','style.md','AGENTS.md','CLAUDE.md')){Copy-Item -LiteralPath "$root/sample-project/$item" -Destination "$bundle/sample-project" -Recurse}
Copy-Item "$root/tools/vidcli.js" "$bundle/tools/"
Copy-Item "$root/out/*.js" "$bundle/out/"
Copy-Item "$root/package.json" $bundle
Copy-Item "$root/LICENSE" "$bundle/CUTLINE-LICENSE.txt"
Copy-Item "$PSScriptRoot/ABOUT.md" $bundle
Copy-Item "$root/README.md" $bundle
Copy-Item "$PSScriptRoot/Cutline.ico" $bundle
$csc=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$icon=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Cutline.ico'))
$launcher=[IO.Path]::GetFullPath((Join-Path $bundle 'Cutline.exe'))
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Launcher.cs'))
& $csc /nologo /target:winexe /reference:System.Windows.Forms.dll "/win32icon:$icon" "/out:$launcher" $source
CheckExit 'Launcher compilation'
if(!(Test-Path "$bundle/resources/app/LICENSE.txt") -or !(Test-Path "$bundle/resources/app/ThirdPartyNotices.txt")){throw 'Missing upstream license notices'}
# Seed a local sample history for the Versions demo without inheriting user credentials.
& git -C "$bundle/sample-project" init;CheckExit 'Sample git init'
Set-Content "$bundle/sample-project/.gitignore" ".cutline-cache/`nexports/" -Encoding ASCII
& git -C "$bundle/sample-project" add .;CheckExit 'Sample git add'
& git -C "$bundle/sample-project" -c user.name=Cutline -c user.email=demo@cutline.invalid -c commit.gpgsign=false commit -m 'Initial Cutline demo';CheckExit 'Sample git commit'
$manifest=@{vscodium=$version;url=$url;sha256=$published;vsixSha256=(Get-FileHash "$root/dist/cutline.vsix").Hash}
$manifest | ConvertTo-Json | Set-Content "$bundle/BUILD.json" -Encoding UTF8
$zip=Join-Path $dist 'Cutline-win-x64.zip'
if(Test-Path $zip){Remove-Item -LiteralPath $zip}
[IO.Compression.ZipFile]::CreateFromDirectory($bundle,$zip,[IO.Compression.CompressionLevel]::Optimal,$true)
Get-FileHash $zip -Algorithm SHA256
Write-Host "Built $zip"
