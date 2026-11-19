$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$temp=Join-Path $root '.test-data/launcher'
New-Item -ItemType Directory -Force "$temp/install/sample-project","$temp/documents","$temp/explicit space" | Out-Null
Set-Content "$temp/install/sample-project/timeline.json" 'original'
Add-Type -Path "$PSScriptRoot/Launcher.cs" -ReferencedAssemblies System.Windows.Forms
$type=([System.Management.Automation.PSTypeName]'Launcher').Type
$resolve=$type.GetMethod('ResolveProject')
$project=$resolve.Invoke($null,@("$temp/install",[string[]]@(),"$temp/documents"))
if($project -ne [IO.Path]::Combine("$temp/documents",'Cutline','sample-project')){throw 'Wrong default project'}
Set-Content "$project/timeline.json" 'edited'
$again=$resolve.Invoke($null,@("$temp/install",[string[]]@(),"$temp/documents"))
if((Get-Content "$again/timeline.json") -ne 'edited'){throw 'Existing user edits overwritten'}
$explicit=$resolve.Invoke($null,@("$temp/install",[string[]]@("$temp/explicit space"),"$temp/documents"))
if($explicit -ne [IO.Path]::GetFullPath("$temp/explicit space")){throw 'Folder argument ignored'}
$failed=$false
try{$resolve.Invoke($null,@("$temp/install",[string[]]@("$temp/missing"),"$temp/documents"))}catch{$failed=$true}
if(!$failed){throw 'Missing folder accepted'}
Write-Output 'Launcher folder argument, first copy, and edit preservation passed'
