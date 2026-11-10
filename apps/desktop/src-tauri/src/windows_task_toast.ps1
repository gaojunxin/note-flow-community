# 只接收宿主通过环境传入的数据；任务标题和URI不得插入PowerShell代码。
$ErrorActionPreference = 'Stop'
$appId = $env:NOTEFLOW_TOAST_APP_ID
$scheme = $env:NOTEFLOW_TOAST_SCHEME
$executable = $env:NOTEFLOW_TOAST_EXECUTABLE
if ($scheme -notmatch '^noteflow(-community)?-task$') { throw '无效任务提醒协议' }
if (-not [IO.File]::Exists($executable)) { throw '客户端程序不存在' }
# 按用户注册，可用于安装版及免安装版；协议只负责唤醒，实体权限仍由客户端复核。
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$scheme")
try { $key.SetValue('', 'URL:NoteFlow task'); $key.SetValue('URL Protocol', '') } finally { $key.Dispose() }
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$scheme\shell\open\command")
try { $key.SetValue('', ('"' + $executable + '" "%1"')) } finally { $key.Dispose() }
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\AppUserModelId\$appId")
try { $key.SetValue('DisplayName', '迹语'); $key.SetValue('IconUri', $executable) } finally { $key.Dispose() }
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($env:NOTEFLOW_TOAST_XML)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
