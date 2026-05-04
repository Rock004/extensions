(function() {
  const out = [];
  function log(msg) { console.log('[翻译诊断]', msg); out.push(msg); }

  log('=== 开始诊断 ===');

  // 1. 脚本是否加载
  log('ACTIVE_SITE 变量: ' + (typeof ACTIVE_SITE !== 'undefined' ? ACTIVE_SITE : '脚本未加载!'));
  log('按钮是否存在: ' + !!document.getElementById('x-translator-btn'));
  log('按钮 wrapper 是否存在: ' + !!document.getElementById('x-translator-btn-wrapper'));

  // 2. shadow DOM 扫描
  function scanTextareas(root, depth) {
    const indent = '  '.repeat(depth);
    const ta = root.querySelectorAll('textarea:not([readonly]):not([disabled])');
    if (ta.length) {
      ta.forEach(function(el) {
        const host = root.host ? root.host.tagName.toLowerCase() : 'document';
        log(indent + 'textarea in <' + host + '> value="' + (el.value||'').substring(0,30) + '"');
      });
    }
    for (const el of root.querySelectorAll ? root.querySelectorAll('*') : []) {
      if (el.shadowRoot) scanTextareas(el.shadowRoot, depth + 1);
    }
  }
  log('--- 扫描所有 shadow DOM 中的 textarea ---');
  scanTextareas(document, 0);

  // 3. faceplate-textarea-input
  var fps = document.querySelectorAll('faceplate-textarea-input');
  log('faceplate-textarea-input 数量: ' + fps.length);
  fps.forEach(function(el, i) {
    var sr = el.shadowRoot;
    var ta = sr ? sr.querySelector('textarea') : null;
    log('  [' + i + '] shadowRoot: ' + !!sr + ', textarea: ' + !!ta);
    if (ta) {
      log('       value: "' + (ta.value||'').substring(0,50) + '"');
      log('       visible: ' + (ta.getBoundingClientRect().width > 0));
    }
  });

  // 4. light DOM textarea
  var lightTA = document.querySelectorAll('textarea');
  log('Light DOM textarea 总数: ' + lightTA.length);

  // 5. 手动测试注入
  if (!document.getElementById('x-translator-btn-wrapper')) {
    log('--- 手动测试注入 ---');
    var fp = document.querySelector('faceplate-textarea-input');
    if (fp && fp.shadowRoot) {
      var ta = fp.shadowRoot.querySelector('textarea');
      if (ta) {
        var wrapper = document.createElement('div');
        wrapper.id = 'x-translator-btn-wrapper';
        wrapper.style.cssText = 'position:fixed;z-index:999999;right:10px;top:200px;background:red;color:white;padding:10px;border-radius:8px;font-size:12px;';
        wrapper.textContent = '测试按钮 - 能看到说明注入成功';
        document.body.appendChild(wrapper);
        setTimeout(function() {
          if (document.getElementById('x-translator-btn-wrapper')) {
            log('手动注入成功！按钮已添加到 body');
          } else {
            log('手动注入失败！按钮被移除了');
          }
        }, 500);
      } else {
        log('faceplate 没有找到 textarea');
      }
    } else if (lightTA.length > 0) {
      log('没有 faceplate，但有 light DOM textarea: ' + lightTA.length + ' 个');
    } else {
      log('没有找到任何 textarea。请先点击一个评论/回复框再运行诊断。');
    }
  }

  log('=== 诊断完成 ===');
  return out;
})();
