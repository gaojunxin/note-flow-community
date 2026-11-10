const TEXT_EXTENSIONS=new Set([
  'txt','text','md','markdown','mdx','rst','adoc','org','log',
  'json','jsonc','json5','jsonl','ndjson','geojson','har','xml','xsd','xsl','xslt','svg','yaml','yml','toml','ini','cfg','conf','config','properties','env','editorconfig','gitignore','gitattributes','npmrc','yarnrc','lock',
  'csv','tsv','sql','graphql','gql','proto','diff','patch',
  'html','htm','css','scss','sass','less','styl',
  'js','mjs','cjs','jsx','ts','mts','cts','tsx','vue','svelte',
  'java','kt','kts','groovy','gradle','scala','sc','clj','cljs','cljc',
  'py','pyw','rb','php','go','rs','c','h','cc','cpp','cxx','hpp','cs','fs','fsx','swift','dart','lua','r','m','mm',
  'sh','bash','zsh','fish','ps1','psm1','bat','cmd','awk','sed',
  'dockerfile','makefile','cmake','ninja','nginx','pem','crt','cer','csr','pub'
])
const TEXT_MIME=/^(text\/|application\/(json|ld\+json|xml|yaml|x-yaml|javascript|graphql|sql|toml|x-httpd-php|x-sh))/i
export function fileExtension(filename=''){const leaf=filename.split(/[\\/]/).pop()||'',lower=leaf.toLocaleLowerCase();if(['dockerfile','makefile','cmakelists.txt'].includes(lower))return lower==='cmakelists.txt'?'cmake':lower;return lower.includes('.')?lower.split('.').pop()||'':lower}
export function isTextPreviewFile(filename='',mediaType=''){return TEXT_MIME.test(mediaType)||TEXT_EXTENSIONS.has(fileExtension(filename))}
export function isPdfPreviewFile(filename='',mediaType=''){return mediaType==='application/pdf'||fileExtension(filename)==='pdf'}
export function isImagePreviewFile(filename='',mediaType=''){return mediaType.startsWith('image/')||['png','jpg','jpeg','gif','webp','bmp','avif','svg','ico'].includes(fileExtension(filename))}
export function isAudioPreviewFile(filename='',mediaType=''){return mediaType.startsWith('audio/')||['mp3','wav','ogg','m4a','aac','flac','opus'].includes(fileExtension(filename))}
export function isVideoPreviewFile(filename='',mediaType=''){return mediaType.startsWith('video/')||['mp4','webm','ogv','mov','m4v'].includes(fileExtension(filename))}
export function canInlinePreview(filename='',mediaType=''){return isPdfPreviewFile(filename,mediaType)||isTextPreviewFile(filename,mediaType)||isImagePreviewFile(filename,mediaType)||isAudioPreviewFile(filename,mediaType)||isVideoPreviewFile(filename,mediaType)}
export function inferMediaType(filename='',mediaType=''){mediaType=mediaType.split(';')[0].trim().toLowerCase();if(mediaType&&!['application/octet-stream','binary/octet-stream'].includes(mediaType))return mediaType;const extension=fileExtension(filename),mapped:Record<string,string>={pdf:'application/pdf',json:'application/json',jsonc:'application/json',json5:'application/json',jsonl:'application/x-ndjson',ndjson:'application/x-ndjson',xml:'application/xml',svg:'image/svg+xml',yaml:'text/yaml',yml:'text/yaml',csv:'text/csv',tsv:'text/tab-separated-values',md:'text/markdown',markdown:'text/markdown',html:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',cjs:'text/javascript',ts:'text/typescript',tsx:'text/typescript',sh:'text/x-shellscript',bash:'text/x-shellscript',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',avif:'image/avif',ico:'image/vnd.microsoft.icon',tif:'image/tiff',tiff:'image/tiff',heic:'image/heic',heif:'image/heif',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',opus:'audio/ogg',mp4:'video/mp4',webm:'video/webm'};return mapped[extension]||(isTextPreviewFile(filename,'')?'text/plain':'application/octet-stream')}
