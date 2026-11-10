<script setup lang="ts">
import {computed, ref} from 'vue'
import {appInfo} from '../services/appInfo'
import {productIdentity} from '../content/productIdentity'
import notices from '../content/thirdPartyNotices.json'
const query = ref('')
const visibleNotices = computed(() => notices.entries.filter(entry => `${entry.name} ${entry.license}`.toLowerCase().includes(query.value.trim().toLowerCase())))
</script>

<template>
  <div class="about-product">
    <header><h1>关于迹语</h1><p>让想法留下轨迹。</p></header>
    <section class="identity"><img src="/ji-yu-icon.png" alt=""><div><h2>迹语 · JIYU</h2><p>应用版本 {{appInfo.versionLabel}}</p><p>围绕笔记、任务、专注和回顾构建的私人工作空间。</p></div></section>
    <section><h2>作者与联系</h2><dl><div><dt>作者</dt><dd>{{productIdentity.author || '待填写'}} · 独立开发者</dd></div><div><dt>联系与反馈</dt><dd><a v-if="productIdentity.contactEmail" :href="`mailto:${productIdentity.contactEmail}`">{{productIdentity.contactEmail}}</a><span v-else>待填写</span></dd></div></dl><p>反馈问题时，请提供应用版本和复现步骤；发送截图或诊断文件前，请检查其中的个人信息。</p></section>
    <details><summary>隐私说明</summary><div class="details-body">
      <p>本说明介绍当前客户端的数据处理方式。使用自行部署的服务时，服务运营者还应提供其身份、联系方式、服务器保存期限及删除规则。</p>
      <h3>本机存储与同步</h3><p>笔记、任务、项目、日志和相关附件用于实现记录、搜索及整理。桌面端在本机保存数据，Web 端按账号保存在当前站点的浏览器存储中。使用服务器同步时，相关业务数据及附件会上传至所连接的服务器。普通笔记及其同步数据目前不提供端到端加密。</p>
      <h3>AI 与外部服务</h3><p>使用 AI 功能时，为完成请求所选择的内容和指令会发送到配置的本地模型、个人模型接口，或经服务器调用的模型服务。发送前请确认内容和服务商；接收方的数据保存规则由其提供。天气功能在获得定位许可后，会向 Open-Meteo 发送经精度处理的坐标以查询天气。打开外部链接或加载外部资源也可能连接其网站。</p>
      <h3>保险箱与软件锁</h3><p>保险箱内容采用独立加密保护。软件锁用于限制进入应用界面，不等同于加密整个知识库。普通导出、备份和 AI 整合草稿可能包含明文内容，请妥善保存；保险箱的加密导出与普通备份分别管理。</p>
      <h3>权限与诊断</h3><p>文件选择、录音和定位用于对应功能，你可以通过系统或浏览器设置管理权限。诊断导出由你主动操作，使用限定字段记录版本、状态及汇总信息。请在发送任何反馈材料前检查内容。</p>
      <h3>保存、导出与删除</h3><p>你可以查看、编辑和导出自己的数据。回收站中的内容尚未永久删除；清理本机数据不会自动删除服务器副本，云端重置也有独立确认步骤。本机数据、草稿及自行保存的备份需按用途清理，服务器副本和备份的保留时间由所连接服务的运营者说明。关闭可选功能或撤销权限可停止后续相关操作，已发送的数据需联系接收方处理。</p>
      <h3>联系与变更</h3><p>对本客户端的数据处理有疑问，或需要协助行使查阅、导出、删除等权利，请通过上方邮箱联系作者。功能和数据处理方式变更时，会随应用版本更新本说明。</p>
    </div></details>
    <details><summary>第三方许可</summary><div class="details-body">
      <p>感谢开源项目及资源作者。各组件遵循自己的许可；这些许可不授予迹语自有代码的使用权。</p>
      <p>{{notices.scope}}</p>
      <p>内置 diagrams.net、字体和原生组件另有许可。diagrams.net 主代码使用 Apache-2.0，部分图形资源另有使用限制，libavoid-js 使用 LGPL-2.1。完整分发许可及对应源材料仍需补齐审核，本页不代表发布许可审核已经完成。</p>
      <label class="license-search">搜索组件或许可<input v-model="query" type="search" placeholder="例如 Vue、MIT" /></label>
      <p>{{visibleNotices.length}} 个组件</p>
      <details v-for="entry in visibleNotices" :key="`${entry.name}@${entry.version}`" class="license-entry"><summary>{{entry.name}} · {{entry.version}} · {{entry.license}}</summary><template v-if="entry.texts.length"><div v-for="text in entry.texts" :key="text.file"><h3>{{text.file}}</h3><pre>{{text.text}}</pre></div></template><p v-else>尚未收录该版本的许可原文，需补齐核对。</p></details>
    </div></details>
  </div>
</template>

<style scoped>
.about-product{max-width:860px;display:grid;gap:18px;color:var(--text-primary)}
header h1{font-size:20px;margin:0}h2{font-size:16px;margin:0 0 12px}h3{font-size:14px;margin:20px 0 8px}p{font-size:13px;line-height:1.8;margin:8px 0;color:var(--text-secondary)}
section,details{border:1px solid var(--border-color,#e1e8e5);border-radius:10px;padding:18px;background:var(--bg-primary,#fff)}
.identity{display:flex;align-items:center;gap:18px}.identity img{width:56px;height:56px}.identity p{margin:4px 0}
dl{margin:0}dl>div{display:flex;gap:20px;padding:6px 0;font-size:13px}dt{min-width:80px;color:var(--text-secondary)}dd{margin:0;overflow-wrap:anywhere}a{color:var(--primary-color,#16785e)}summary{cursor:pointer;font-size:14px;font-weight:600}.details-body{padding-top:12px}.license-search{display:grid;gap:8px;font-size:13px}.license-search input{max-width:360px;padding:8px;border:1px solid var(--border-color,#e1e8e5);border-radius:6px;background:transparent;color:inherit}.license-entry{padding:12px;margin-top:8px}.license-entry summary{font-size:12px;overflow-wrap:anywhere}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;max-height:400px;overflow:auto}
</style>
