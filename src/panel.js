// The floating panel: the same three pages as the original site (practice / record / compose),
// drawn on a 2D canvas that is used as a texture. Every clickable thing is registered while
// drawing, so hit-testing always matches what is on screen.
import { SEALS } from './matcher.js';
import { sealLabel, compactSeal, jutsuLabel, translate } from './i18n.js';

export const PANEL_W = 1600;
export const PANEL_H = 900;
const FONT = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif';
const C = { bg: '#10151d', panel: '#1b2430', border: '#303c4a', cell: '#101720', cellBorder: '#435163', accent: '#f5bb5a', accentBg: '#49391f', text: '#edf1f6', muted: '#a6b2c0', ok: '#6ee7a0', btn: '#2a3646', btnText: '#edf1f6', off: '#222b37', offText: '#5d6b7b', hover: '#ffe3a8' };

// cellW:imgH keeps the source tile's 4:3 shape (417.5 x 314 px per tile in the sheet)
const GRID = { x: 30, y: 182, cols: 4, gap: 14, cellW: 226, imgH: 170, capH: 38, rowGap: 10 };
const RIGHT = { x: 1070, w: 500 };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Wrap text to a pixel width; breaks between CJK characters and at spaces for Latin text. */
function wrap(ctx, text, maxW) {
  const tokens = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) ?? [];
  const lines = []; let line = '';
  for (const t of tokens) {
    const next = line + t;
    if (ctx.measureText(next).width > maxW && line.trim()) { lines.push(line.trimEnd()); line = t.trimStart(); } else line = next;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

export function createPanel(sheet) {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_W; canvas.height = PANEL_H;
  const ctx = canvas.getContext('2d');
  let hits = [];

  function text(str, x, y, { size = 24, color = C.text, weight = 400, align = 'left', maxW = 0, lh = 1.35, mono = false } = {}) {
    ctx.font = `${weight} ${size}px ${mono ? 'ui-monospace,Menlo,monospace' : FONT}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top';
    if (!maxW) { ctx.fillText(str, x, y); return size * lh; }
    const lines = wrap(ctx, str, maxW);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh));
    return Math.max(1, lines.length) * size * lh;
  }

  function button(id, label, x, y, w, h, { enabled = true, primary = false, active = false, size = 26 } = {}, st) {
    const hovered = enabled && st.hover === id;
    ctx.fillStyle = !enabled ? C.off : active ? C.accentBg : primary ? C.accent : C.btn;
    roundRect(ctx, x, y, w, h, 12); ctx.fill();
    ctx.lineWidth = hovered ? 4 : 2;
    ctx.strokeStyle = hovered ? C.hover : active ? C.accent : enabled ? C.cellBorder : C.off;
    ctx.stroke();
    let fit = size;
    ctx.font = `${primary ? 700 : 500} ${fit}px ${FONT}`;
    while (fit > 14 && ctx.measureText(label).width > w - 20) { fit -= 1; ctx.font = `${primary ? 700 : 500} ${fit}px ${FONT}`; }
    ctx.fillStyle = !enabled ? C.offText : primary ? '#2b1c00' : active ? '#ffdc98' : C.btnText;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    if (enabled) hits.push({ id, x, y, w, h });
  }

  function sealCell(i, seal, st, { clickId, status, highlight }) {
    const col = i % GRID.cols, row = Math.floor(i / GRID.cols);
    const x = GRID.x + col * (GRID.cellW + GRID.gap);
    const y = GRID.y + row * (GRID.imgH + GRID.capH + GRID.rowGap);
    const h = GRID.imgH + GRID.capH;
    const hovered = clickId && st.hover === clickId;
    ctx.fillStyle = highlight ? C.accentBg : C.cell;
    roundRect(ctx, x, y, GRID.cellW, h, 10); ctx.fill();
    ctx.save(); roundRect(ctx, x, y, GRID.cellW, h, 10); ctx.clip();
    if (sheet && sheet.complete && sheet.naturalWidth) {
      const sw = sheet.naturalWidth / 4, sh = sheet.naturalHeight / 3;
      ctx.drawImage(sheet, col * sw, row * sh, sw, sh, x, y, GRID.cellW, GRID.imgH);
    } else { ctx.fillStyle = '#18202b'; ctx.fillRect(x, y, GRID.cellW, GRID.imgH); }
    ctx.restore();
    ctx.lineWidth = hovered ? 4 : highlight ? 3 : 2;
    ctx.strokeStyle = hovered ? C.hover : highlight ? C.accent : C.cellBorder;
    roundRect(ctx, x, y, GRID.cellW, h, 10); ctx.stroke();
    text(sealLabel(seal), x + 12, y + GRID.imgH + 7, { size: 23, weight: 600 });
    if (status) text(status.text, x + GRID.cellW - 12, y + GRID.imgH + 11, { size: 17, align: 'right', color: status.color });
    if (clickId) hits.push({ id: clickId, x, y, w: GRID.cellW, h });
  }

  function chips(list, x, y, maxW, matched = 0) {
    // sequence chips: seal → seal → ...
    ctx.font = `600 24px ${FONT}`;
    let cx = x, cy = y;
    if (!list.length) return text(translate('点击左侧结印，添加到顺序中'), x, y, { size: 21, color: C.muted, maxW });
    list.forEach((seal, i) => {
      const label = compactSeal(seal);
      ctx.font = `600 24px ${FONT}`;
      const w = ctx.measureText(label).width + 26;
      const arrowW = i ? 34 : 0;
      if (cx + arrowW + w > x + maxW) { cx = x; cy += 46; }
      else if (i) { text('→', cx + 6, cy + 5, { size: 22, color: i >= list.length - matched && matched ? C.ok : C.muted }); cx += arrowW; }
      const isMatched = i >= list.length - matched && matched > 0;
      ctx.fillStyle = isMatched ? '#1e4d36' : '#243142'; roundRect(ctx, cx, cy, w, 38, 10); ctx.fill();
      text(label, cx + 13, cy + 5, { size: 24, weight: 600, color: isMatched ? C.ok : C.text });
      cx += w + 4;
    });
    return cy + 46 - y;
  }

  function techniqueList(list, x, y, maxW, maxRows) {
    let cy = y;
    if (!list.length) return text(translate('还没有保存忍术。'), x, y, { size: 20, color: C.muted });
    list.slice(0, maxRows).forEach((t) => {
      text(jutsuLabel(t.name), x, cy, { size: 22, weight: 700 });
      cy += 30;
      cy += text(t.seals.map(compactSeal).join(' → '), x, cy, { size: 19, color: C.muted, maxW });
      cy += 8;
    });
    if (list.length > maxRows) text(`… +${list.length - maxRows}`, x, cy, { size: 19, color: C.muted });
    return cy - y;
  }

  function draw(st) {
    hits = [];
    ctx.clearRect(0, 0, PANEL_W, PANEL_H);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, PANEL_W, PANEL_H);
    ctx.fillStyle = C.panel; roundRect(ctx, 0, 0, PANEL_W, PANEL_H, 28); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.border; roundRect(ctx, 1.5, 1.5, PANEL_W - 3, PANEL_H - 3, 28); ctx.stroke();

    // header: brand, page tabs, language, recenter
    {
      const brand = translate('忍术练习 VR'); let bs = 34;
      ctx.font = `800 ${bs}px ${FONT}`;
      while (bs > 18 && ctx.measureText(brand).width > 280) { bs -= 1; ctx.font = `800 ${bs}px ${FONT}`; }
      text(brand, 30, 26 + (34 - bs) / 2, { size: bs, weight: 800, color: C.accent });
    }
    const tabs = [['practice', '忍术练习'], ['record', '手势录制'], ['compose', '忍术录入']];
    tabs.forEach(([id, label], i) => button(`tab:${id}`, translate(label), 330 + i * 285 / 1.5, 20, 182, 62, { active: st.page === id, size: 26 }, st));
    button('lang:zh', '中文', 1190, 20, 110, 62, { active: st.lang === 'zh', size: 24 }, st);
    button('lang:en', 'English', 1310, 20, 140, 62, { active: st.lang === 'en', size: 24 }, st);
    button('recenter', '⟲', 1470, 20, 100, 62, { size: 30 }, st);

    // intro line (mirrors the original eyebrow / title)
    const copy = {
      record: ['录下单个手势', '录制每个结印的不同角度，供忍术录入和忍术练习识别。'],
      compose: ['创建你的忍术', '点击选择结印顺序，保存为一个有名字的连招。'],
      practice: ['开始忍术练习', '按照已保存的顺序结印，完成后显示对应名称。'],
    }[st.page];
    text(translate(copy[0]), 30, 98, { size: 30, weight: 800 });
    text(translate(copy[1]), 30, 108 + 34, { size: 20, color: C.muted, maxW: 1010 });

    // seal grid (left)
    SEALS.forEach((seal, i) => {
      if (st.page === 'record') {
        const recorded = st.recorded.has(seal);
        sealCell(i, seal, st, { clickId: st.busy ? null : `seal:${seal}`, highlight: st.selected === seal, status: { text: translate(recorded ? '已录' : '未录'), color: recorded ? C.ok : C.muted } });
      } else if (st.page === 'compose') {
        sealCell(i, seal, st, { clickId: `add:${seal}` });
      } else {
        sealCell(i, seal, st, { highlight: st.lastSeal === seal });
      }
    });

    // right column
    const x = RIGHT.x, w = RIGHT.w;
    if (st.page === 'record') {
      text(translate(`${st.recorded.size} / 12 已录`), x, 108, { size: 22, color: C.muted });
      let y = 150;
      y += text(translate(st.selectedLine), x, y, { size: 28, weight: 700 }) + 4;
      y += text(translate(st.instruction), x, y, { size: 21, color: C.muted, maxW: w }) + 6;
      button('record', translate('开始录制'), x, y, w - 130, 64, { enabled: st.canRecord, primary: true, size: 28 }, st);
      if (st.count) text(translate(st.count), x + w - 110, y + 6, { size: 40, weight: 800, color: C.accent });
      y += 78;
      y += text(translate('倒数 3 秒准备，然后录制 5 秒。保持结印，缓慢调整角度。'), x, y, { size: 18, color: C.muted, maxW: w }) + 8;
      y += text(translate(st.result), x, y, { size: 30, weight: 800, color: st.success ? C.ok : C.text }) + 2;
      y += text(translate('录制和练习时，识别到一只或两只手都可以匹配对应的样本。'), x, y, { size: 18, color: C.muted, maxW: w }) + 10;
      button('practice', translate('验证当前结印'), x, y, w, 54, { enabled: st.canPracticeCurrent, size: 24 }, st); y += 64;
      button('practice-all', translate('识别全部已录结印'), x, y, w, 54, { enabled: st.canPracticeAll, size: 24 }, st); y += 64;
      text(translate('灵敏度') + `  ${st.sensitivity.toFixed(1)}`, x, y + 10, { size: 22 });
      button('sens-', '−', x + 230, y, 120, 50, { size: 30 }, st);
      button('sens+', '+', x + 360, y, 120, 50, { size: 30 }, st); y += 60;
      button('clear-selected', translate('清除当前'), x, y, 200, 46, { enabled: st.recorded.has(st.selected) && !st.busy, size: 21 }, st);
      if (st.saved) text(translate(st.saved), x + 215, y + 10, { size: 18, color: C.muted, maxW: w - 215 });
    } else if (st.page === 'compose') {
      text(`${translate('当前结印顺序')}  ${translate(`${st.draft.length} 个`)}`, x, 108, { size: 22, color: C.muted });
      let y = 150;
      y += Math.max(46, chips(st.draft, x, y, w)) + 8;
      button('draft-undo', translate('撤销最后一个'), x, y, 240, 52, { enabled: st.draft.length > 0, size: 22 }, st);
      button('draft-clear', translate('清空顺序'), x + 260, y, 240, 52, { enabled: st.draft.length > 0, size: 22 }, st); y += 64;
      button('technique-save', translate('保存忍术（自动命名）'), x, y, w, 56, { enabled: st.draft.length > 0, primary: true, size: 24 }, st); y += 66;
      if (st.message) y += text(translate(st.message), x, y, { size: 20, color: C.ok, maxW: w }) + 6;
      text(translate('已保存的忍术'), x, y, { size: 22, weight: 700 }); y += 36;
      techniqueList(st.techniques, x, y, w, 5);
    } else {
      let y = 150;
      button('sequence-practice', translate(st.seqActive ? '结束练习' : '开始练习'), x, y, w, 64, { primary: true, active: st.seqActive, size: 28 }, st); y += 76;
      y += text(translate(st.seqStatus), x, y, { size: 28, weight: 800, color: /^✓/.test(st.seqStatus) ? C.ok : C.text, maxW: w }) + 8;
      if (st.history.length) { y += chips(st.history.slice(-8), x, y, w, st.matchedCount) + 6; }
      if (st.speed) y += text(translate(st.speed), x, y, { size: 24, weight: 700, color: C.accent }) + 6;
      y += 6;
      text(translate('已保存的忍术'), x, y, { size: 22, weight: 700 }); y += 36;
      techniqueList(st.techniques, x, y, w, 5);
    }

    // footer
    text(translate('用手柄射线或手部捏合点击按钮；结印时请把手柄放下，使用手部追踪。'), 30, 856, { size: 17, color: C.muted });
    if (st.debug) text(st.debug, 1570, 856, { size: 17, color: C.muted, align: 'right', mono: true });
  }

  /** Which button is at this canvas pixel? */
  function hit(px, py) {
    for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h.id; }
    return null;
  }
  return { canvas, draw, hit, get hits() { return hits; } };
}
