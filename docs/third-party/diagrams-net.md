# diagrams.net 离线供应链与安全边界

PC 端只允许使用随安装包交付的固定版本 diagrams.net Web 应用，不访问 `app.diagrams.net`，也不嵌入 diagrams.net Desktop。当前锁定官方 `v31.4.6`（annotated tag对象 `861262a764223cf70d4c9310f25798a0956c9017`，实际源码commit `744cb5420fdf126efd7a09b1d7082ca3e12c0841`），正式图表入口仅在本地 manifest 校验为可用时启用。

## 供应链

- 上游：`jgraph/drawio`，编辑器代码许可证 Apache-2.0；当前JGraph图标/模板目录附带Atlassian用途限制，不能归为CC BY 4.0；社区已按维护者决定移除此类资源，不授予 diagrams.net/draw.io 商标使用权。
- 版本、commit 和入口文件 SHA-256 固定在 `apps/desktop/src/canvas/diagrams/vendor-lock.json`。
- 当前入口 `index.html` SHA-256 为 `e1d2cc03e8f21296e14869e302c84781e8b4768615d6ef4260caa50e7fa26d59`。更新版本时必须重新审核并修改锁文件，再运行 `npm run vendor:diagrams -- <本地已审核的 webapp 目录>`。
- 脚本不下载网络资源；它只校验并复制本地目录，生成运行时 manifest。发布 SBOM 必须记录版本、commit、入口摘要和许可证，并保留上游 LICENSE/NOTICE。
- Vendor 脚本只保留本地编辑所需的 UI、语言、基础图形、UML/网络 stencil 和数学渲染资源；明确删除云盘连接器、协作传输、服务器构件、在线模板与外部插件。当前裁剪产物约 115 MiB、3023 个文件，逐文件 SHA-256 写入 `noteflow-sbom.json`。

## 运行时隔离

- 编辑器位于双层 sandbox iframe，本地桥接页把上游 JSON embed 协议转换为 NoteFlow 白名单协议。WebView2 对打包资源返回绑定 `http://tauri.localhost` 的 CORS 响应，因此两层都保留 `allow-same-origin`，以便读取同包语言资源。这一信任边界仅适用于已固定提交、完整性清单和离线审核的 diagrams.net 代码；宿主消息仍要求同源、精确 iframe source 和随机 nonce 同时匹配。
- CSP 目标：外层桥接页保持 `connect-src 'none'`；编辑器页仅允许 `connect-src 'self'`，用于读取同源的 `resources/*.txt` 语言资源，不允许访问任何外部网络。
- PC 端默认以 `lang=zh` 启动离线编辑器，使用随包固定的 `resources/dia_zh.txt` 简体中文资源，不依赖系统语言或外网。
- 宿主只处理 `ready/save/export/error/dirty`，只发送 `configure/load/export`。每条消息校验 iframe source、精确 origin、协议版本、随机 nonce、requestId 和 8 MiB 上限；请求默认 15 秒超时。
- 远程图片不自动请求网络。后续 D04 必须将其拒绝或转换为受控 CanvasAsset/附件，缩略图失败不得影响原始 XML 保存。

`vendor-manifest.json` 当前为 `available=true`，入口只指向随包交付的 `noteflow-bridge.html`。资源缺失或校验失败时必须退回 `available=false`，不得改成在线 URL。

## 社区版图表裁剪（OSS-12）

维护者已同意社区版保留基础图表编辑，移除libavoid自动避障布线。完整集成版资源保留原样；社区生产构建和独立源码导出均使用 `community/templates/public/vendor/diagrams/` 的固定模板。

`node scripts/audit/prepare-community-diagrams.mjs` 先校验原始文件摘要，再裁去 `extensions.min.js` 最后完整的libavoid求解器/共享路由核/绑定片段，删除开发加载入口。社区导出清单排除 `js/libavoid-js/` 与 `js/diagramly/LibavoidRouting.js`；源码审计策略禁止回流。仅删除独立文件不足以移除内嵌构建。已有上游菜单、格式面板及布局选择器通过 `typeof LibavoidRouting` 判断隐藏相关入口，普通直角连线和基础布局保留；已有文件中的样式/未知布局字段不主动删除。

社区SBOM记录本次修改及固定源摘要，并校正GraphViewer.js、mxCabinets.js两份既有资源的过时摘要；不改写这两份代码。升级上游时摘要门禁会失败，必须重新审核裁剪边界，不能按字符串盲目裁剪新版本。第三方字体/图形仍按原许可保留；社区主许可证不会覆盖它们。

真实离线编辑器的隔离合成图形验收证据归OSS-12审计；独立前端构建和资源SHA检查不能替代真实服务、Tauri窗口或用户资料验收。Web生产产物随附项目许可及已汇集的npm/Cargo许可原文，尚未解决的分发缺口继续由release门禁拦截。

### 受限图库与许可来源更正

复核发现当前img/shapes/stencils的LICENSE不是CC BY 4.0，而是附带Atlassian生态用途限制；之前笼统归类不准确。维护者已同意社区仅保留通用形状、连线及基础流程图。社区物理移除三个目录、行业Sidebar-*源文件和检索索引，并用空加载文件替换两份内嵌压缩图库；PostConfig使用自研基础palette，不注册或启用行业图库。旧图未知图形用占位渲染，原始shape/style/自定义字段保留，不请求被移除资源；侧栏有可见限制说明。完整集成版保持原始资源，不能据此将受限资源重新授权为Apache。

版本出处先前将annotated tag对象写为commit。已通过GitHub tag API解析实际源码commit；index.html摘要仍与版本标签原文一致，不构成版本更换。源码URL应使用实际commit或版本tag，不能因tag对象SHA对应raw URL的404就判断源码不存在。

Linux MPL组件完整crate源与官方许可原文纳入公开材料，逐份摘要匹配Cargo.lock；Cargo许可来源有固定上游提交，seahash使用明确标注的Debian同版本补充材料。该集合含构建依赖，不能冒充其他平台或AppImage内实际共享库的分发许可结论。
