import {readFile, readdir, lstat, realpath} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * 上传前核对本次社区PC交付的双格式、版本及逐文件SHA-256。
 * 只证明清单与文件完整性，不代替安装、启动或平台许可验收。
 */
export async function verifyCommunityArtifacts(root, platform, deliveryDirectory) {
  if (!['linux', 'windows'].includes(platform)) throw Error('platform必须为linux或windows')
  root = await realpath(root)
  const {version} = JSON.parse(await readFile(path.join(root, 'version.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw Error('无效交付版本')
  const output = deliveryDirectory ? path.resolve(deliveryDirectory) : path.join(root, 'artifacts/pc', version, 'community')
  if (await realpath(output) !== output) throw Error('交付目录不能经过符号链接')
  const manifestFile = path.join(output, 'manifest.json')
  if ((await lstat(manifestFile)).isSymbolicLink()) throw Error('清单不能为符号链接')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (manifest.version !== version || manifest.edition !== 'community' || manifest.product !== 'pc') throw Error('清单版本或产品不一致')
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw Error('交付清单为空')
  const names = new Set(['manifest.json'])
  for (const entry of manifest.files) {
    if (typeof entry.name !== 'string' || !entry.name || /[/\\]/.test(entry.name) || entry.name === '.' || entry.name === '..' || names.has(entry.name)) throw Error('交付文件名越界或重复')
    names.add(entry.name)
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('交付大小或SHA-256格式无效')
    const file = path.join(output, entry.name), stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file) !== file) throw Error('交付包含非普通文件')
    if (stat.size !== entry.size) throw Error(`交付大小不符：${entry.name}`)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    if (hash.digest('hex') !== entry.sha256) throw Error(`交付SHA-256不符：${entry.name}`)
  }
  const actual = await readdir(output)
  if (actual.length !== names.size || actual.some(name => !names.has(name))) throw Error('交付目录存在未列入清单的内容')
  const required = platform === 'linux'
    ? [['installer', /\.deb$/i], ['portable', /\.AppImage$/i]]
    : [['installer', /\.exe$/i], ['portable', /-portable\.zip$/i]]
  for (const [kind, pattern] of required) {
    if (!manifest.files.some(entry => entry.kind === kind && pattern.test(entry.name))) throw Error(`缺少${platform} ${kind}交付格式`)
  }
  return {platform, version, files: manifest.files.length, output}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--platform') throw Error('Usage: node scripts/verify-community-artifacts.mjs --platform <linux|windows>')
  console.log(JSON.stringify(await verifyCommunityArtifacts(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), args[1]), null, 2))
}
