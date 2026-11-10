(function () {
  const Core = window.AcrosticCore;
  const $ = id => document.getElementById(id);
  const textEl = $('text'), poemBox = $('poemBox'), metaEl = $('meta'), toastEl = $('toast');
  const rhymeSel = $('rhyme');

  let seed = 1;
  let last = null;

  // 填充韵部下拉
  Core.RHYMES.forEach(g => {
    const o = document.createElement('option');
    o.value = g.name;
    o.textContent = g.label + '（如：' + g.chars.slice(0, 4) + '）';
    rhymeSel.appendChild(o);
  });

  function getLen() {
    const r = document.querySelector('input[name=len]:checked');
    return r ? Number(r.value) : 5;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  function render(r) {
    const rhymeChars = new Set(Array.from(r.rhymeChars));
    const html = r.lines.map((line, i) => {
      const chars = Array.from(line);
      const isRhymeLine = r.lines.length === 1 || i % 2 === 1;
      const inner = chars.map((c, j) => {
        const cls = j === 0 ? 'head' : (isRhymeLine && j === chars.length - 1 && rhymeChars.has(c) ? 'rhyme' : '');
        return cls ? `<span class="${cls}">${c}</span>` : c;
      }).join('');
      return `<div class="line" style="animation-delay:${i * 90}ms">${inner}</div>`;
    }).join('');
    const seal = `<div class="seal">${r.lines.length} 句 · ${r.len} 言<br>${r.rhymeLabel}</div>`;
    poemBox.innerHTML = `<div class="poem-lines">${html}</div>${seal}`;

    const sc = Core.rhymeScore(r);
    metaEl.innerHTML =
      `<span>藏头：<b>${r.head}</b></span>` +
      `<span>韵部：<b>${r.rhymeLabel}</b>（${r.rhyme}）</span>` +
      `<span>押韵：<b>${sc.hit}/${sc.total}</b> 偶数句</span>`;
    last = r;
  }

  function compose(bump) {
    const text = textEl.value.trim();
    if (!text) { toast('先写几个字吧'); textEl.focus(); return; }
    if (bump) seed++;
    try {
      const r = Core.compose(text, {
        len: getLen(),
        seed: seed,
        rhyme: rhymeSel.value || undefined
      });
      render(r);
      // 地址栏记住（方便分享书签）
      try { history.replaceState(null, '', '#w=' + encodeURIComponent(text)); } catch (e) {}
    } catch (e) {
      toast(e.message || '生成失败');
    }
  }

  $('go').addEventListener('click', () => compose(true));
  $('again').addEventListener('click', () => {
    if (!textEl.value.trim()) { toast('先写几个字吧'); return; }
    compose(true);
  });
  textEl.addEventListener('keydown', e => { if (e.key === 'Enter') compose(true); });
  rhymeSel.addEventListener('change', () => compose(false));
  document.querySelectorAll('input[name=len]').forEach(el => el.addEventListener('change', () => compose(false)));

  $('copy').addEventListener('click', () => {
    if (!last) { toast('还没有诗'); return; }
    const txt = last.lines.join('\n') + '\n\n—— 藏头：' + last.head;
    navigator.clipboard.writeText(txt).then(() => toast('已复制 🖋'), () => toast('复制失败，手动选吧'));
  });

  // 自动换一版：每 6 秒重排一版（有输入时）
  let timer = null;
  $('autoNext').addEventListener('change', e => {
    clearInterval(timer);
    if (e.target.checked) {
      compose(true);
      timer = setInterval(() => { if (textEl.value.trim()) compose(true); }, 6000);
    }
  });

  // 从 URL hash 恢复
  const m = /#w=(.+)$/.exec(location.hash);
  if (m) {
    try { textEl.value = decodeURIComponent(m[1]); } catch (e) {}
  }
  if (!textEl.value) textEl.value = '今天很好';
  compose(false);
  textEl.focus();
})();
