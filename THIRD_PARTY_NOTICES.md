# 第三方材料与核验状态

社区自研代码采用 [Apache-2.0](LICENSE)。以下第三方组件保持原许可；不得将项目主许可套用于全部依赖。本文件覆盖社区源码候选及记录的Web构建；原生安装包分发另行核验。

| 组件 | 许可及随附位置 | 状态 |
| --- | --- | --- |
| diagrams.net / drawio v31.4.6（源码提交744cb5420fdf126efd7a09b1d7082ca3e12c0841） | Apache-2.0，apps/desktop/public/vendor/diagrams/LICENSE | 编辑器由本项目裁剪为离线资源；逐文件摘要见同目录 noteflow-sbom.json |
| JGraph 行业图形、模板及图片 | 社区版不分发 | 当前上游资源附带Atlassian用途限制，不能笼统当作CC BY 4.0；已移除目录、压缩图库及行业侧栏，基础图形由本项目基于Apache编辑器内置形状编排 |
| libavoid-js | 社区版不分发 | 已移除独立求解器、路由核、绑定及 extensions 内嵌构建；基础图表编辑保留 |
| Liberation 2.1.5 字体 | SIL OFL-1.1，apps/desktop/public/vendor/fonts/liberation-2.1.5/source/LICENSE、AUTHORS | 对应字体源与构建说明随目录保留 |
| npm 依赖 | docs/third-party/npm-inventory.json 列出当前安装包版本、声明许可及许可文本摘要 | 449 组版本的核对快照；已汇集445组原文，4组仍需按实际分发范围核对。原文见 npm-license-texts.txt，来源/摘要见 npm-license-review.json；khroma元数据虽缺license字段，随包原文为MIT |
| Rust 及其他传递依赖 | 版本由 Cargo.lock / package-lock.json 固定，适用各包原许可 | Linux锁定解析489组依赖，489组均已取得许可材料（含固定上游提交及明确标注的发行版补充）。见 cargo-license-review-linux.json 和 cargo-license-texts-linux.txt；包含构建依赖，不代表最终二进制链接清单或其他平台验收 |

维护者已同意社区版移除libavoid自动避障布线。固定31.4.6上游的extensions bundle末段内嵌了该求解器，因此本项目同时裁去该末段、独立文件和开发加载入口。修改记录与逐文件摘要见 apps/desktop/public/vendor/diagrams/noteflow-sbom.json；不能仅删除菜单或独立JS文件。相关菜单沿用上游能力判断隐藏，普通直角连线仍可使用。

正式分发前须完成上述缺口、保留各组件版权及许可原文、按实际源码/安装包范围形成材料。许可证文件存在不代表发布门禁已通过。

## 基础图表与旧文件

维护者已选择社区只保留通用形状、连线和基础流程图。不分发img/shapes/stencils目录、两份压缩图库或行业侧栏源码；两份同名JS空加载文件仅保持启动协议。旧文件中的未知图形标识和样式不删除，行业图标可显示为占位图形，侧栏有可见说明；不会自动下载已移除图库。

v31.4.6的861262a764223cf70d4c9310f25798a0956c9017是annotated tag对象，不是源码commit；解析后的源码提交为744cb5420fdf126efd7a09b1d7082ca3e12c0841。以tag对象当源码URL会404，不能将这种404直接当作源码不存在的证据。

## MPL源码与补充材料

Linux解析图中cssparser、cssparser-macros、dtoa-short、option-ext和selectors保持MPL-2.0。完整未修改发布源码及官方许可原文在 [sources目录清单](docs/third-party/sources/manifest.json)，每份crate摘要已与Cargo.lock比对；项目自研代码的Apache许可不限制收件人对这些源文件的原有权利。原文与来源也随Web产物交付。参见 [Mozilla官方FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。

Radix旧包未附原文/gitHead，按同一仓库在首次发布日期前最后修改的LICENSE固定提交补充，发布包声明MIT；此为许可沿革核对，不声称取得对应实现源码。seahash使用Debian同版本源码包的版权/许可材料补充，作者与上游Cargo声明一致；不声称恢复了上游不存在的LICENSE文件。详见JSON中的supplementNote。

另外4组原文实际位于随包README（agent-base、https-proxy-agent、fastdom、strictdom），完整声明已纳入。react-remove-scroll-bar采用同库固定历史提交的补充原文，明确标注为补充材料。剩余依赖声明不直接等于实际分发；Web构建生成bundled-modules.json记录Rollup纳入模块，仍需另查预编译vendor和字体。

## 源码公开范围

[源码分发核对](docs/third-party/source-distribution-review.json)与[实际Web模块](docs/third-party/reviewed-web-modules.json)记录184组模块均有许可材料。4组剩余安装依赖未纳入此Web构建，其实现/原生二进制亦不随白名单源码交付，原文缺项如实保留；不能据此宣称它们的原文已经找到。源码公开门禁与原生包实际平台库门禁分开，后者仍未通过。

图表预编译资源另附 [识别与摘要](docs/third-party/vendor-license-review.json)及 [许可原文](docs/third-party/vendor-license-texts.txt)，保留Spin、JSZip、pako、CryptoJS、DOMPurify、roughjs、perfect-freehand的归属。版本不明的两份上游vendored JS明确使用父版本/字节摘要定位，不将许可参考版本当作其编译版本。其他上游编辑器代码保留同目录Apache LICENSE及原有文件头。
