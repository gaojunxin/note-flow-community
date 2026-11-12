# 支持范围与安装

| 平台 | 本轮交付与证据 | 边界 |
| --- | --- | --- |
| Web/PWA | Chromium 实际本地保存、离线重载、完整备份与基础画布 | 部署整个 Web ZIP 到站点根目录；离线缓存需首次成功安装，浏览器存储可能被用户清理 |
| Linux x86_64 | 历史DEB已有SQLite与本地图表验证；本轮完成原生编译检查和独立Web构建 | 当前源码安装包仍需实机复验；桌面提醒需应用运行，其他Linux桌面环境未穷举 |
| Windows x64 | 标准脚本及GitHub Windows 2022任务生成NSIS与绿色ZIP，实际runner结果待核对 | 需要Windows 10/11和WebView2；不以配置检查代替安装/启动验收 |
| macOS | 当前标准社区原生打包流程不支持 | 不以共享代码存在代替原生双格式和设备验收 |

## 公共开发环境

Node.js 22、PowerShell 7、Rust 稳定工具链。Linux 桌面构建需要 libwebkit2gtk-4.1-dev、libgtk-3-dev、libssl-dev、libayatana-appindicator3-dev、librsvg2-dev、patchelf、build-essential 与 pkg-config；安装命令以所用发行版包管理器为准。


依赖安装 npm ci；公开 CI 只读取公开工作区，既不拉取私有源码，也不需要产品账号或发布密钥。首次下载 npm/Cargo 公共依赖需要网络，运行应用的单机功能不需要同步服务。

## GitHub Actions

`.github/workflows/ci.yml`在push/PR或手动触发时，通过Ubuntu22.04与Windows2022的独立任务调用`scripts/build-pc.ps1`。两平台任务互不因另一平台失败而取消；每个平台必须完成测试、双格式打包和清单摘要验证后才上传。下载位置为该次Actions的Artifacts，保留14天，不自动发布Release。

Windows任务检查7-Zip及Visual Studio x64可再分发CRT；这些工具按[GitHub Windows 2022托管镜像清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md)准备。Linux安装WebKitGTK、GTK、OpenSSL、AppIndicator、librsvg、patchelf及libfuse2，用Xvfb提供原生测试显示环境；AppImage提取运行环境变量用于CI打包工具，参见[AppImage官方FUSE说明](https://github.com/AppImage/AppImageKit/wiki/FUSE)。这些是构建环境配置，不代表应用已经通过所有平台发行验收。

## 产物

PC：artifacts/pc/<version>/community/。每次交付包含 manifest.json，核对版本、edition、文件大小和 SHA256。目录中的历史文件不构成当前版本证明。

## 数据保护

PC定期导出完整空间备份并另存其他设备。社区版不交付移动端或知识功能，旧空间的知识、卡片及未知实体仍保留在备份中，不因入口关闭清理记录。备份可能包含私人内容，禁止上传到公开 Issue。密码库主密码不会保存在文件中；遗失后不能恢复密文。恢复创建新空间；卸载/清除应用数据或网站存储前先导出。

未知规则不自动推进；显式转为普通任务前保留原规则。缺失/不兼容的私有组件不阻断单机保存与取回。PC 官方/社区往返需要官方端显式预览确认，不能把旧纪元操作直接上传。
