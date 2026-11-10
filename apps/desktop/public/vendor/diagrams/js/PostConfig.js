/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;

/** 社区图表只使用 Apache-2.0 编辑器内置的基础图形，不注册行业图库或受限模板。 */
(function () {
  var label = function (key, zh, en) { return mxResources.get(key) || (String(mxClient.language).indexOf('zh') === 0 ? zh : en); };
  // 旧文件保留原始图形标识并使用默认占位渲染；不按标识请求已移除的图库。
  mxStencilRegistry.getStencil = function (name) { return this.stencils[name] || null; };
  Sidebar.prototype.defaultEntries = 'general;flowchart';
  Sidebar.prototype.enabledLibraries = ['general', 'flowchart'];
  Sidebar.prototype.createMoreShapes = function () {
    // 图库资源已物理移除，不能保留可以重新启用行业图库的入口。
    var footer = document.createElement('div');
    footer.style.display = 'none';
    return footer;
  };
  Sidebar.prototype.init = function () {
    this.shapetags = {};
    this.entries = [];
    var notice = document.createElement('div');
    notice.style.cssText = 'padding:10px 12px;font-size:12px;line-height:1.5;color:inherit;opacity:.75;white-space:normal;overflow-wrap:anywhere';
    notice.textContent = String(mxClient.language).indexOf('zh') === 0 ? '社区版提供基础图形；原图中的行业图标可能显示为占位图形。' : 'Basic shapes are available. Industry icons in existing files may appear as placeholders.';
    this.appendChild(notice);
    this.addPaletteFunctions('general', mxResources.get('general'), true, [
      this.createVertexTemplateEntry('rounded=0;whiteSpace=wrap;html=1;', 120, 60, '', mxResources.get('rectangle')),
      this.createVertexTemplateEntry('rounded=1;whiteSpace=wrap;html=1;', 120, 60, '', mxResources.get('rounded')),
      this.createVertexTemplateEntry('shape=ellipse;whiteSpace=wrap;html=1;', 100, 70, '', mxResources.get('ellipse')),
      this.createVertexTemplateEntry('shape=rhombus;whiteSpace=wrap;html=1;', 90, 90, '', mxResources.get('diamond')),
      this.createVertexTemplateEntry('shape=triangle;whiteSpace=wrap;html=1;', 90, 80, '', mxResources.get('triangle')),
      this.createVertexTemplateEntry('text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;', 100, 40, mxResources.get('text'), mxResources.get('text')),
      this.createEdgeTemplateEntry('edgeStyle=orthogonalEdgeStyle;endArrow=classic;html=1;', 100, 60, '', mxResources.get('orthogonal')),
      this.createEdgeTemplateEntry('edgeStyle=none;endArrow=classic;html=1;', 100, 0, '', mxResources.get('straight'))
    ]);
    this.addPaletteFunctions('flowchart', mxResources.get('flowchart'), true, [
      this.createVertexTemplateEntry('rounded=1;arcSize=50;whiteSpace=wrap;html=1;', 120, 50, '', label('start', '开始 / 结束', 'Start / End')),
      this.createVertexTemplateEntry('rounded=0;whiteSpace=wrap;html=1;', 120, 60, '', mxResources.get('process')),
      this.createVertexTemplateEntry('shape=rhombus;whiteSpace=wrap;html=1;', 100, 100, '', label('decision', '条件判断', 'Decision')),
      this.createVertexTemplateEntry('shape=cylinder;whiteSpace=wrap;html=1;', 100, 90, '', label('database', '数据存储', 'Database')),
      this.createVertexTemplateEntry('shape=swimlane;horizontal=1;whiteSpace=wrap;html=1;', 220, 140, '', label('swimlane', '泳道', 'Swimlane'))
    ]);
    this.defaultPaletteOrder = this.getCurrentPaletteOrder();
  };
  var init = EditorUi.prototype.init;
  EditorUi.prototype.init = function () {
    var result = init.apply(this, arguments);
    var shapes = this.actions.get('shapes');
    if (shapes != null) {
      shapes.setEnabled(false);
      shapes.visible = false;
    }
    return result;
  };
})();
