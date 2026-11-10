// worker 与页面不共享全局对象，必须在解析器模块执行前单独补齐兼容能力。
import './pdfPromiseCompatibility'
import './pdfBufferCompatibility'
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
