import {readFile, mkdir, copyFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {verifyCommunityArtifacts} from './verify-community-artifacts.mjs'

/** 校验同一次运行的两端附件，再生成不重名的发布文件和对应清单；不调用远端发布接口。 */
export async function prepareCommunityRelease(root, tag) {
  const {version} = JSON.parse(await readFile(path.join(root, 'version.json'), 'utf8'))
  if (tag !== `v${version}`) throw Error('发布标签必须与version.json一致')
  const deliveries = []
  for (const platform of ['linux', 'windows']) {
    const input = path.join(root, 'artifacts/release-input', `community-${platform}-x64-${version}`)
    await verifyCommunityArtifacts(root, platform, input)
    deliveries.push({platform, input, manifest: JSON.parse(await readFile(path.join(input, 'manifest.json'), 'utf8'))})
  }
  // 两端全部验证后才准备输出；拒绝复用旧目录，防止混入上次发布文件。
  const output = path.join(root, 'artifacts/release-assets')
  await mkdir(output)
  const sums = []
  for (const {platform, input, manifest} of deliveries) {
    const prefix = `${platform}-x64-`
    for (const entry of manifest.files) {
      const original = entry.name
      entry.name = prefix + original
      await copyFile(path.join(input, original), path.join(output, entry.name))
      sums.push(`${entry.sha256}  ${entry.name}`)
    }
    const name = `${prefix}manifest.json`, content = JSON.stringify(manifest, null, 2) + '\n'
    await writeFile(path.join(output, name), content)
    sums.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`)
  }
  await writeFile(path.join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
  await writeFile(path.join(root, 'artifacts/release-notes.md'), `NoteFlow Community ${version}\n\n- Linux x64：DEB 安装包、AppImage 免安装包。\n- Windows x64：NSIS 安装器、portable.zip 绿色包（完整解压后运行，需系统 WebView2）。\n- Linux AppImage 下载后执行 chmod +x。\n- 两端分别附 Web 资源 ZIP 及 manifest.json；Web ZIP 不是桌面免安装包。\n- SHA256SUMS.txt 记录附件校验值；Linux 可执行 sha256sum -c SHA256SUMS.txt。\n\n本次附件经双平台构建、测试和摘要校验，未作代码签名；不代表已经完成实际安装、启动或平台许可验收。\n`)
  return {version, output, assets: sums.length + 1}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  console.log(JSON.stringify(await prepareCommunityRelease(root, process.env.RELEASE_TAG), null, 2))
}
