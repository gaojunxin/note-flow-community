[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer,[Parameter(Mandatory)][string]$OutputDirectory,[Parameter(Mandatory)][string]$Version)
$ErrorActionPreference='Stop'
$sevenZip=Get-Command 7z -ErrorAction SilentlyContinue
$extractor=if($sevenZip){$sevenZip.Source}else{Join-Path $env:ProgramFiles '7-Zip/7z.exe'}
if(!(Test-Path -LiteralPath $extractor)){throw 'Tauri绿色包需要7-Zip提取本次NSIS安装器载荷。'}
$payload=Join-Path $OutputDirectory ('portable-payload-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $payload -Force|Out-Null
& $extractor x $Installer ('-o'+$payload) -y
if($LASTEXITCODE){throw '安装器载荷提取失败'}
$portable=Join-Path $OutputDirectory ('portable-stage-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $portable -Force|Out-Null
foreach($entry in Get-ChildItem -LiteralPath $payload){
  if($entry.Name -eq '$PLUGINSDIR' -or $entry.Name -match '^(uninstall|uninst)(\.exe)?$'){continue}
  if($entry.Name.StartsWith('$')){throw ('无法识别NSIS载荷目录：'+$entry.Name)}
  Copy-Item -LiteralPath $entry.FullName -Destination $portable -Recurse -Force
}
$executables=@(Get-ChildItem -LiteralPath $portable -File -Filter '*.exe')
if($executables.Count -ne 1){throw '绿色包必须含唯一应用EXE，拒绝未知安装载荷'}
# Use redistributable app-local CRT files, never DLLs copied from System32.
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if(!(Test-Path -LiteralPath $vswhere)){throw '未找到Visual Studio可再分发CRT定位工具'}
$vs=& $vswhere -latest -products '*' -property installationPath
$crt=Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Redist/MSVC') -Directory|Where-Object Name -Match '^\d+\.\d+\.\d+$'|Sort-Object {[version]$_.Name} -Descending|ForEach-Object {Join-Path $_.FullName 'x64/Microsoft.VC143.CRT'}|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
if(!$crt){throw '未找到x64可再分发CRT'}
Copy-Item -Path (Join-Path $crt '*.dll') -Destination $portable -Force
$readme=@"
NoteFlow $Version - Windows x64 portable

Extract the entire ZIP and run $($executables[0].Name).
Application resources are embedded in the executable or included alongside it.
Microsoft VC runtime DLLs are included app-locally.
Requires Windows 10/11 x64 with Microsoft Edge WebView2 Runtime installed.
WebView2 is not included in this archive. Use the installer when the runtime is missing.
Settings and workspace data use the normal per-user application directories.
This archive does not make the application data portable or isolated from an existing installation.
"@
[IO.File]::WriteAllText((Join-Path $portable 'README-portable.txt'),$readme,[Text.UTF8Encoding]::new($false))
$archive=Join-Path $OutputDirectory "NoteFlow-$Version-portable.zip"
Compress-Archive -Path (Join-Path $portable '*') -DestinationPath $archive -Force
Write-Host "绿色包：$archive"
