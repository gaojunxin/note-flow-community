[CmdletBinding()]
param([switch]$SkipInstall,[switch]$WebOnly,[switch]$InstallerOnly,[ValidateSet('all','nsis','msi','deb')][string]$Bundles='all')
$ErrorActionPreference = 'Stop'
# Ubuntu开发默认仅DEB；显式all用于生产双格式，Windows继续使用安装器与绿色包。
if ($IsLinux -and -not $PSBoundParameters.ContainsKey('Bundles')) { $Bundles='deb'; $InstallerOnly=$true }
if ($InstallerOnly -and ($WebOnly -or -not $IsLinux -or $Bundles -ne 'deb')) { throw 'InstallerOnly仅用于Linux DEB开发包。' }
if (-not $WebOnly -and $IsLinux -and $Bundles -ne 'all' -and -not $InstallerOnly) { throw 'Linux开发请使用 -Bundles deb -InstallerOnly；生产请使用 -Bundles all。' }
if (-not $WebOnly -and $IsWindows -and $Bundles -notin @('all','nsis')) { throw 'Windows社区原生交付需要NSIS与绿色包，请使用 -Bundles nsis 或 all。' }
if (-not $WebOnly -and -not $IsLinux -and -not $IsWindows) { throw '当前社区原生交付脚本只验证Windows/Linux流程，其他平台请使用 -WebOnly。' }
$repo = Split-Path -Parent $PSScriptRoot
$version = Get-Content (Join-Path $repo 'version.json') -Raw | ConvertFrom-Json
Push-Location $repo
try {
  node (Join-Path $PSScriptRoot 'check-community-version.mjs'); if ($LASTEXITCODE) { throw '社区版本不一致' }
  if (-not $SkipInstall) { npm ci; if ($LASTEXITCODE) { throw '依赖安装失败' } }
  npm test; if ($LASTEXITCODE) { throw '社区测试失败' }
  if (-not $WebOnly) { npm run test:native; if ($LASTEXITCODE) { throw '社区原生测试失败' } }
  npm run build; if ($LASTEXITCODE) { throw '社区构建失败' }
  $target = Join-Path $repo 'artifacts/.build/tauri/community'
  if (-not $WebOnly) {
    $previousTarget = $env:CARGO_TARGET_DIR
    $env:CARGO_TARGET_DIR = $target
    Push-Location (Join-Path $repo 'apps/desktop/src-tauri')
    try {
      cargo test --locked --manifest-path Cargo.toml
      if ($LASTEXITCODE) { throw '社区桌面原生测试失败' }
      # 显式选择本轮格式；不能从旧缓存补齐本轮未生成的安装包。
      $nativeBundles = if ($IsLinux) { if($InstallerOnly){'deb'}else{'deb,appimage'} } else { 'nsis' }
      $argsList = @('build','--bundles',$nativeBundles)
      $currentBundleRoot = Join-Path $target ('release/bundle/' + $(if($InstallerOnly){'deb'}else{''}))
      if(Test-Path -LiteralPath $currentBundleRoot){
        if(!([IO.Path]::GetFullPath($currentBundleRoot).StartsWith([IO.Path]::GetFullPath($target)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))){throw 'bundle清理路径越界'}
        Remove-Item -LiteralPath $currentBundleRoot -Recurse -Force
      }
      $cli = Join-Path $repo 'node_modules/.bin/tauri'
      if ($IsWindows) { $cli += '.cmd' }
      & $cli @argsList
      if ($LASTEXITCODE) { throw '社区桌面构建失败' }
    } finally { Pop-Location; $env:CARGO_TARGET_DIR = $previousTarget }
  }
  $installers = @()
  if (-not $WebOnly) {
    $bundleRoot = Join-Path $target 'release/bundle'
    if ($Bundles -ne 'all') { $bundleRoot = Join-Path $bundleRoot $Bundles }
    $pattern = '(?<![0-9A-Za-z.])' + [regex]::Escape([string]$version.version) + '(?![0-9A-Za-z.])'
    $installers = @(Get-ChildItem $bundleRoot -Recurse -File | Where-Object { $_.Extension -in '.exe','.msi','.deb','.rpm','.dmg','.AppImage' -and $_.Name -match $pattern })
    if (-not $installers.Count) { throw '未生成当前版本社区安装包' }
  }
  if ($IsLinux -and -not $WebOnly -and $Bundles -in @('all','deb')) {
    python3 (Join-Path $PSScriptRoot 'check-linux-glibc.py') (Join-Path $target 'release/bundle/deb')
    if ($LASTEXITCODE) { throw 'Linux glibc 兼容性检查失败：请在 Ubuntu 22.04 构建。' }
  }
  $portableFiles = @()
  if (-not $WebOnly -and $IsWindows) {
    $nsis = @($installers | Where-Object Extension -eq '.exe')
    if ($nsis.Count -ne 1) { throw '绿色包需要本次唯一NSIS安装器，拒绝旧包或多载荷。' }
    $portableStage = Join-Path $target ('portable-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $portableStage -Force | Out-Null
    & (Join-Path $PSScriptRoot 'build/new-tauri-portable.ps1') -Installer $nsis[0].FullName -OutputDirectory $portableStage -Version ([string]$version.version)
    $portableFiles = @(Get-ChildItem -LiteralPath $portableStage -File -Filter '*-portable.zip')
    if ($portableFiles.Count -ne 1) { throw '未生成当前社区绿色包。' }
  }
  if (-not $WebOnly -and $IsLinux -and -not $InstallerOnly) {
    if (-not @($installers | Where-Object Extension -eq '.deb').Count -or -not @($installers | Where-Object Extension -eq '.AppImage').Count) { throw '缺少DEB或AppImage，社区原生交付不完整。' }
  }
  $output = Join-Path $repo "artifacts/pc/$($version.version)/community"
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  Get-ChildItem $output -File | Remove-Item -Force
  $archive = Join-Path $output "NoteFlow-$($version.version)-community-web.zip"
  if(-not $InstallerOnly){Compress-Archive -Path (Join-Path $repo 'apps/desktop/dist-community/*') -DestinationPath $archive -Force}
  foreach ($installer in @($installers) + @($portableFiles)) { Copy-Item $installer.FullName $output -Force }
  $files = @(Get-ChildItem $output -File | ForEach-Object { @{name=$_.Name;kind=$(if($_.Name -match '-portable.zip$' -or $_.Extension -eq '.AppImage'){'portable'}elseif($_.Extension -in '.exe','.msi','.deb','.rpm','.dmg'){'installer'}else{'web-resources'});size=$_.Length;sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
  [ordered]@{edition='community';product='pc';version=$version.version;channel=$version.channel;contractVersion=1;storageSchemaVersion=1;builtAt=(Get-Date).ToUniversalTime().ToString('o');installerOnly=[bool]$InstallerOnly;packageFormats=$(if($WebOnly){@('web-resources')}elseif($InstallerOnly){@('installer')}else{@('installer','portable')});files=$files} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $output 'manifest.json') -Encoding utf8
} finally { Pop-Location }
