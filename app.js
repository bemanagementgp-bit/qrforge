/* QRForge – app logic. Vanilla JS, ES2020. Depends on qrcode-generator (global `qrcode`) + monetize.js helpers. */
(function () {
  'use strict';

  const C = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'qrforge_state_v1';
  const FREE_MAX = 1000;
  const PRO_MAX = 4000;
  const LOGO_RATIO = 0.2;
  const TYPES = ['url', 'text', 'wifi', 'email', 'phone', 'sms', 'vcard'];

  // Make the library encode as UTF-8 so accents, emoji and non-Latin text survive.
  if (window.qrcode && typeof TextEncoder !== 'undefined') {
    qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  }

  // ---------- Elements ----------
  const el = {
    tabs: Array.from(document.querySelectorAll('.type-tab')),
    panels: Array.from(document.querySelectorAll('.type-panel')),
    inUrl: $('inUrl'), inText: $('inText'),
    wifiSsid: $('wifiSsid'), wifiPass: $('wifiPass'), wifiEnc: $('wifiEnc'), wifiHidden: $('wifiHidden'),
    emailTo: $('emailTo'), emailSubject: $('emailSubject'), emailBody: $('emailBody'),
    phoneNum: $('phoneNum'), smsNum: $('smsNum'), smsMsg: $('smsMsg'),
    vcName: $('vcName'), vcPhone: $('vcPhone'), vcEmail: $('vcEmail'), vcOrg: $('vcOrg'), vcUrl: $('vcUrl'),
    fgColor: $('fgColor'), fgHex: $('fgHex'), bgColor: $('bgColor'), bgHex: $('bgHex'), transparentBg: $('transparentBg'),
    moduleStyle: $('moduleStyle'), ecLevel: $('ecLevel'),
    sizeRange: $('sizeRange'), sizeValue: $('sizeValue'), sizeMaxHint: $('sizeMaxHint'),
    marginRange: $('marginRange'), marginValue: $('marginValue'),
    logoBtn: $('logoBtn'), logoInput: $('logoInput'), logoName: $('logoName'), logoRemove: $('logoRemove'),
    batchInput: $('batchInput'), btnBatch: $('btnBatch'), batchStatus: $('batchStatus'),
    canvas: $('qrCanvas'), canvasWrap: $('canvasWrap'), qrMeta: $('qrMeta'), scanHint: $('scanHint'),
    btnPng: $('btnPng'), btnSvg: $('btnSvg'), btnCopyImg: $('btnCopyImg'), btnCopyContent: $('btnCopyContent'),
    encodedContent: $('encodedContent'), proPrice: $('proPrice')
  };

  // ---------- State ----------
  const state = {
    type: 'url',
    fields: {},
    fg: '#0b0f17', bg: '#ffffff', transparent: false,
    style: 'square', ec: 'M', size: 600, margin: 4
  };
  // Logo is kept in memory only (never persisted – could be large).
  let logo = { img: null, dataUrl: null, name: '' };
  let current = { qr: null, content: '', error: '' };
  let rafId = 0;

  const FIELD_IDS = ['inUrl', 'inText', 'wifiSsid', 'wifiPass', 'wifiEnc', 'wifiHidden', 'emailTo', 'emailSubject', 'emailBody',
    'phoneNum', 'smsNum', 'smsMsg', 'vcName', 'vcPhone', 'vcEmail', 'vcOrg', 'vcUrl'];

  function readFieldsFromDOM() {
    FIELD_IDS.forEach((id) => {
      const node = el[id];
      if (!node) return;
      state.fields[id] = node.type === 'checkbox' ? node.checked : node.value;
    });
  }
  function writeFieldsToDOM() {
    FIELD_IDS.forEach((id) => {
      const node = el[id];
      if (!node || !(id in state.fields)) return;
      if (node.type === 'checkbox') node.checked = !!state.fields[id];
      else node.value = state.fields[id];
    });
  }

  function save() {
    try {
      readFieldsFromDOM();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable – ignore */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        if (TYPES.includes(s.type)) state.type = s.type;
        if (s.fields && typeof s.fields === 'object') state.fields = s.fields;
        if (isHex(s.fg)) state.fg = s.fg;
        if (isHex(s.bg)) state.bg = s.bg;
        state.transparent = !!s.transparent;
        if (['square', 'rounded', 'dots'].includes(s.style)) state.style = s.style;
        if (['L', 'M', 'Q', 'H'].includes(s.ec)) state.ec = s.ec;
        if (Number.isFinite(s.size)) state.size = clamp(Math.round(s.size), 200, PRO_MAX);
        if (Number.isFinite(s.margin)) state.margin = clamp(Math.round(s.margin), 0, 8);
      }
    } catch (e) { /* corrupt state – ignore */ }
  }

  // ---------- Helpers ----------
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function isHex(s) { return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s); }
  function normalizeHex(s) {
    s = (s || '').trim();
    if (!s.startsWith('#')) s = '#' + s;
    if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return isHex(s) ? s.toLowerCase() : null;
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function escWifi(s) { return String(s).replace(/([\\;,":])/g, '\\$1'); }
  function escVcard(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function slug(s) { return String(s).toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'qr'; }
  function effectiveEc() { return (logo.img && isPro()) ? 'H' : state.ec; }
  function effectiveBg() { return state.transparent ? '#ffffff' : state.bg; }

  // ---------- Content builders ----------
  function buildContent() {
    const f = state.fields;
    const v = (id) => (f[id] == null ? '' : String(f[id])).trim();
    switch (state.type) {
      case 'url': return v('inUrl');
      case 'text': return (f.inText == null ? '' : String(f.inText));
      case 'wifi': {
        const ssid = v('wifiSsid');
        if (!ssid) return '';
        const enc = f.wifiEnc || 'WPA';
        let s = 'WIFI:T:' + enc + ';S:' + escWifi(ssid) + ';';
        if (enc !== 'nopass' && v('wifiPass')) s += 'P:' + escWifi(v('wifiPass')) + ';';
        s += 'H:' + (f.wifiHidden ? 'true' : 'false') + ';;';
        return s;
      }
      case 'email': {
        const to = v('emailTo');
        if (!to) return '';
        const params = [];
        if (v('emailSubject')) params.push('subject=' + encodeURIComponent(v('emailSubject')));
        if (v('emailBody')) params.push('body=' + encodeURIComponent(v('emailBody')));
        return 'mailto:' + to + (params.length ? '?' + params.join('&') : '');
      }
      case 'phone': {
        const n = v('phoneNum').replace(/[^\d+#*]/g, '');
        return n ? 'tel:' + n : '';
      }
      case 'sms': {
        const n = v('smsNum').replace(/[^\d+]/g, '');
        if (!n) return '';
        return 'SMSTO:' + n + ':' + v('smsMsg');
      }
      case 'vcard': {
        const name = v('vcName');
        if (!name && !v('vcPhone') && !v('vcEmail')) return '';
        const parts = name.split(/\s+/);
        const last = parts.length > 1 ? parts.pop() : '';
        const first = parts.join(' ');
        const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + escVcard(last) + ';' + escVcard(first) + ';;;', 'FN:' + escVcard(name)];
        if (v('vcOrg')) lines.push('ORG:' + escVcard(v('vcOrg')));
        if (v('vcPhone')) lines.push('TEL;TYPE=CELL:' + v('vcPhone'));
        if (v('vcEmail')) lines.push('EMAIL;TYPE=INTERNET:' + v('vcEmail'));
        if (v('vcUrl')) lines.push('URL:' + v('vcUrl'));
        lines.push('END:VCARD');
        return lines.join('\n');
      }
    }
    return '';
  }

  // ---------- QR model ----------
  function makeQr(content, ec) {
    const qr = qrcode(0, ec);
    qr.addData(content);
    qr.make();
    return qr;
  }

  // ---------- Rendering ----------
  function drawModule(ctx, x, y, s, style) {
    if (style === 'dots') {
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s * 0.44, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'rounded') {
      const r = s * 0.3;
      const inset = s * 0.06;
      const x0 = x + inset, y0 = y + inset, w = s - inset * 2;
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.arcTo(x0 + w, y0, x0 + w, y0 + w, r);
      ctx.arcTo(x0 + w, y0 + w, x0, y0 + w, r);
      ctx.arcTo(x0, y0 + w, x0, y0, r);
      ctx.arcTo(x0, y0, x0 + w, y0, r);
      ctx.closePath();
      ctx.fill();
    } else {
      // Slight overdraw avoids hairline seams between squares at fractional module sizes.
      ctx.fillRect(x, y, s + 0.5, s + 0.5);
    }
  }

  /** Render a QR to a canvas with the given options. Returns false if content empty/invalid. */
  function renderToCanvas(canvas, qr, opts) {
    const size = opts.size;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    if (!opts.transparent) {
      ctx.fillStyle = opts.bg;
      ctx.fillRect(0, 0, size, size);
    }
    const n = qr.getModuleCount();
    const total = n + opts.margin * 2;
    const m = size / total;
    const off = opts.margin * m;
    ctx.fillStyle = opts.fg;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) drawModule(ctx, off + c * m, off + r * m, m, opts.style);
      }
    }
    if (opts.logo) {
      const box = Math.round(size * LOGO_RATIO);
      const pad = Math.max(2, Math.round(m * 0.8));
      const bx = Math.round((size - box) / 2) - pad;
      const bw = box + pad * 2;
      if (opts.transparent) ctx.clearRect(bx, bx, bw, bw);
      else { ctx.fillStyle = opts.bg; ctx.fillRect(bx, bx, bw, bw); }
      const img = opts.logo;
      const ratio = Math.min(box / img.naturalWidth, box / img.naturalHeight);
      const w = img.naturalWidth * ratio, h = img.naturalHeight * ratio;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    }
    return true;
  }

  function buildSvg(qr, opts) {
    const size = opts.size;
    const n = qr.getModuleCount();
    const total = n + opts.margin * 2;
    const m = size / total;
    const off = opts.margin * m;
    const f = (v) => +v.toFixed(3);
    let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
    out += '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="' + (opts.style === 'square' ? 'crispEdges' : 'geometricPrecision') + '">\n';
    if (!opts.transparent) out += '<rect width="' + size + '" height="' + size + '" fill="' + opts.bg + '"/>\n';
    out += '<g fill="' + opts.fg + '">\n';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        const x = off + c * m, y = off + r * m;
        if (opts.style === 'dots') {
          out += '<circle cx="' + f(x + m / 2) + '" cy="' + f(y + m / 2) + '" r="' + f(m * 0.44) + '"/>';
        } else if (opts.style === 'rounded') {
          const inset = m * 0.06;
          out += '<rect x="' + f(x + inset) + '" y="' + f(y + inset) + '" width="' + f(m - inset * 2) + '" height="' + f(m - inset * 2) + '" rx="' + f(m * 0.3) + '"/>';
        } else {
          out += '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(m) + '" height="' + f(m) + '"/>';
        }
      }
      out += '\n';
    }
    out += '</g>\n';
    if (opts.logo && opts.logoDataUrl) {
      const box = size * LOGO_RATIO;
      const pad = Math.max(2, m * 0.8);
      const bx = (size - box) / 2 - pad;
      const bw = box + pad * 2;
      if (!opts.transparent) out += '<rect x="' + f(bx) + '" y="' + f(bx) + '" width="' + f(bw) + '" height="' + f(bw) + '" fill="' + opts.bg + '"/>\n';
      else out += '<rect x="' + f(bx) + '" y="' + f(bx) + '" width="' + f(bw) + '" height="' + f(bw) + '" fill="#ffffff"/>\n';
      const img = opts.logo;
      const ratio = Math.min(box / img.naturalWidth, box / img.naturalHeight);
      const w = img.naturalWidth * ratio, h = img.naturalHeight * ratio;
      out += '<image x="' + f((size - w) / 2) + '" y="' + f((size - h) / 2) + '" width="' + f(w) + '" height="' + f(h) + '" href="' + escXml(opts.logoDataUrl) + '" xlink:href="' + escXml(opts.logoDataUrl) + '" preserveAspectRatio="xMidYMid meet"/>\n';
    }
    out += '</svg>\n';
    return out;
  }

  function currentOpts(overrides) {
    const useLogo = !!(logo.img && isPro());
    return Object.assign({
      size: state.size, margin: state.margin, fg: state.fg, bg: state.bg, transparent: state.transparent,
      style: state.style, logo: useLogo ? logo.img : null, logoDataUrl: useLogo ? logo.dataUrl : null
    }, overrides || {});
  }

  // ---------- Live update ----------
  function scheduleRender() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(render);
  }

  function render() {
    readFieldsFromDOM();
    const content = buildContent();
    current.content = content;
    current.error = '';
    current.qr = null;

    if (!content) {
      drawEmpty('Enter some content to generate a QR code');
    } else {
      try {
        current.qr = makeQr(content, effectiveEc());
        renderToCanvas(el.canvas, current.qr, currentOpts());
      } catch (e) {
        current.error = 'Content is too long for a QR code (' + content.length + ' chars). Shorten it or lower the error correction level.';
        drawEmpty('Too much data');
      }
    }
    el.encodedContent.textContent = content || '—';
    updateMeta();
    updateScanHint();
    const disabled = !current.qr;
    [el.btnPng, el.btnSvg, el.btnCopyImg].forEach((b) => { b.disabled = disabled; });
    save();
  }

  function drawEmpty(msg) {
    const c = el.canvas;
    c.width = 600; c.height = 600;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 600, 600);
    ctx.fillStyle = state.transparent ? 'rgba(128,128,128,.08)' : state.bg;
    ctx.fillRect(0, 0, 600, 600);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, 300, 300);
  }

  function updateMeta() {
    if (!current.qr) {
      el.qrMeta.textContent = current.error || '';
      el.qrMeta.classList.toggle('warn', !!current.error);
      return;
    }
    const n = current.qr.getModuleCount();
    const ec = effectiveEc();
    el.qrMeta.classList.remove('warn');
    el.qrMeta.textContent = n + '×' + n + ' modules · version ' + ((n - 17) / 4) + ' · error correction ' + ec + (ec !== state.ec ? ' (auto for logo)' : '') + ' · ' + state.size + '×' + state.size + ' px';
  }

  function updateScanHint() {
    const h = el.scanHint;
    h.className = 'scan-hint';
    if (!current.qr) { h.textContent = ''; return; }
    const bg = effectiveBg();
    const ratio = contrastRatio(state.fg, bg);
    const inverted = luminance(state.fg) > luminance(bg);
    const msgs = [];
    let level = 'ok';
    if (ratio < 2.5) { level = 'bad'; msgs.push('Very low contrast (' + ratio.toFixed(1) + ':1) – most scanners will fail. Use a dark foreground on a light background.'); }
    else if (ratio < 4.5) { level = 'warn'; msgs.push('Low contrast (' + ratio.toFixed(1) + ':1) – may fail on some phones. Aim for 4.5:1 or higher.'); }
    if (inverted && ratio >= 2.5) { if (level === 'ok') level = 'warn'; msgs.push('Inverted colors (light on dark) – some older scanner apps cannot read these.'); }
    if (state.transparent) msgs.push('Transparent background: make sure it is placed on a light surface.');
    if (state.margin === 0) { if (level === 'ok') level = 'warn'; msgs.push('No quiet zone – add at least 2 modules of margin unless the surroundings are blank.'); }
    else if (state.margin < 2) msgs.push('Tip: 4 modules of margin is the recommended quiet zone.');
    if (current.qr.getModuleCount() > 77) msgs.push('Dense code (' + current.qr.getModuleCount() + ' modules) – print it larger and test it before mass production.');
    if (logo.img && isPro() && state.style === 'dots') msgs.push('Dots + logo reduce redundancy; test the scan carefully.');
    if (!msgs.length) msgs.push('Good contrast (' + ratio.toFixed(1) + ':1) and quiet zone – this code should scan reliably.');
    h.classList.add(level);
    h.textContent = (level === 'ok' ? '✓ ' : level === 'warn' ? '⚠ ' : '✕ ') + msgs.join(' ');
  }

  // ---------- Downloads / clipboard ----------
  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function filenameBase() { return 'qrforge-' + state.type + '-' + slug(current.content); }

  function downloadPng() {
    if (!current.qr) return;
    const off = document.createElement('canvas');
    renderToCanvas(off, current.qr, currentOpts());
    off.toBlob((blob) => {
      if (!blob) { toast('Could not create PNG'); return; }
      downloadBlob(blob, filenameBase() + '.png');
      toast('PNG downloaded');
      track('download', { format: 'png', type: state.type, size: state.size });
    }, 'image/png');
  }

  function downloadSvg() {
    if (!current.qr) return;
    if (!isPro()) { openPro('svg'); return; }
    const svg = buildSvg(current.qr, currentOpts());
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filenameBase() + '.svg');
    toast('SVG downloaded');
    track('download', { format: 'svg', type: state.type });
  }

  function copyImage() {
    if (!current.qr) return;
    if (!navigator.clipboard || !window.ClipboardItem) { toast('Clipboard images not supported here – use Download PNG'); return; }
    const off = document.createElement('canvas');
    renderToCanvas(off, current.qr, currentOpts({ size: Math.min(state.size, 1000) }));
    try {
      // Pass a promise so Safari keeps the user-gesture context.
      const blobPromise = new Promise((res, rej) => off.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
        .then(() => { toast('Image copied to clipboard'); track('copy', { what: 'image' }); })
        .catch(() => toast('Copy failed – use Download PNG instead'));
    } catch (e) {
      toast('Copy failed – use Download PNG instead');
    }
  }

  function copyContent() {
    if (!current.content) { toast('Nothing to copy'); return; }
    const done = () => { toast('Content copied'); track('copy', { what: 'content' }); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(current.content).then(done).catch(() => fallbackCopy(current.content, done));
    } else fallbackCopy(current.content, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy not supported'); }
    ta.remove();
  }

  // ---------- Logo (Pro) ----------
  function onLogoButton() {
    if (!isPro()) { openPro('logo'); return; }
    el.logoInput.click();
  }
  function onLogoFile(e) {
    const file = e.target.files && e.target.files[0];
    el.logoInput.value = '';
    if (!file) return;
    if (!isPro()) { openPro('logo'); return; }
    if (!/^image\//.test(file.type)) { toast('Please choose an image file'); return; }
    if (file.size > 4 * 1024 * 1024) { toast('Logo must be under 4 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        logo = { img, dataUrl: reader.result, name: file.name };
        el.logoName.textContent = file.name;
        el.logoRemove.classList.remove('hidden');
        toast('Logo added – error correction set to H');
        track('logo_add', {});
        scheduleRender();
      };
      img.onerror = () => toast('Could not load that image');
      img.src = reader.result;
    };
    reader.onerror = () => toast('Could not read file');
    reader.readAsDataURL(file);
  }
  function removeLogo() {
    logo = { img: null, dataUrl: null, name: '' };
    el.logoName.textContent = 'No logo';
    el.logoRemove.classList.add('hidden');
    scheduleRender();
  }

  // ---------- Batch (Pro) ----------
  let batchRunning = false;
  async function runBatch() {
    if (!isPro()) { openPro('batch'); return; }
    if (batchRunning) return;
    const lines = el.batchInput.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { toast('Add at least one line'); return; }
    if (lines.length > 200) { toast('Max 200 codes per batch'); return; }
    batchRunning = true;
    el.btnBatch.disabled = true;
    const off = document.createElement('canvas');
    let ok = 0, failed = 0;
    for (let i = 0; i < lines.length; i++) {
      el.batchStatus.textContent = 'Generating ' + (i + 1) + ' / ' + lines.length + '…';
      try {
        const qr = makeQr(lines[i], effectiveEc());
        renderToCanvas(off, qr, currentOpts());
        const blob = await new Promise((res) => off.toBlob(res, 'image/png'));
        if (!blob) throw new Error('blob');
        downloadBlob(blob, 'qrforge-' + String(i + 1).padStart(3, '0') + '-' + slug(lines[i]) + '.png');
        ok++;
      } catch (e) { failed++; }
      // Browsers throttle rapid-fire downloads; a short pause keeps them all.
      await new Promise((r) => setTimeout(r, 350));
    }
    el.batchStatus.textContent = ok + ' downloaded' + (failed ? ', ' + failed + ' failed (too long)' : '');
    toast('Batch complete: ' + ok + ' QR codes');
    track('batch', { count: ok });
    batchRunning = false;
    el.btnBatch.disabled = false;
  }

  // ---------- Tabs ----------
  function setType(type, focusInput) {
    if (!TYPES.includes(type)) type = 'url';
    state.type = type;
    el.tabs.forEach((t) => {
      const on = t.dataset.type === type;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    el.panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== type));
    if (focusInput) {
      const first = document.querySelector('#panel-' + type + ' input, #panel-' + type + ' textarea');
      if (first) first.focus();
    }
    scheduleRender();
  }

  // ---------- Pro UI ----------
  function refreshUI() {
    const pro = isPro();
    const max = pro ? PRO_MAX : FREE_MAX;
    el.sizeRange.max = String(max);
    if (state.size > max) { state.size = max; el.sizeRange.value = String(max); el.sizeValue.textContent = String(max); }
    el.sizeMaxHint.innerHTML = pro
      ? 'Pro: export up to 4000px for large-format print.'
      : 'Free up to 1000px · <a href="#" onclick="openPro(\'size\');return false">Pro unlocks 4000px</a>';
    document.querySelectorAll('.pro-badge').forEach((b) => {
      if (b.closest('#proModal') || b.closest('.pro-card')) return;
      b.classList.toggle('hidden', pro);
    });
    if (!pro && logo.img) removeLogo();
    const price = C.PRO_PRICE || '$9';
    if (el.proPrice) el.proPrice.textContent = price;
    document.querySelectorAll('[data-pro-price]').forEach((n) => { n.textContent = price; });
    scheduleRender();
  }

  // ---------- Init ----------
  function bind() {
    el.tabs.forEach((t) => {
      t.addEventListener('click', () => { setType(t.dataset.type, true); track('type_change', { type: t.dataset.type }); });
      t.addEventListener('keydown', (e) => {
        const i = el.tabs.indexOf(t);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const nx = (i + (e.key === 'ArrowRight' ? 1 : -1) + el.tabs.length) % el.tabs.length;
          el.tabs[nx].focus(); setType(el.tabs[nx].dataset.type, false);
        }
      });
    });

    FIELD_IDS.forEach((id) => {
      const node = el[id];
      if (!node) return;
      node.addEventListener('input', scheduleRender);
      node.addEventListener('change', scheduleRender);
    });

    // Colors: picker <-> hex text kept in sync.
    const syncColor = (picker, hexInput, key) => {
      picker.addEventListener('input', () => { state[key] = picker.value.toLowerCase(); hexInput.value = state[key]; scheduleRender(); });
      hexInput.addEventListener('input', () => {
        const h = normalizeHex(hexInput.value);
        hexInput.classList.toggle('invalid', !h);
        if (h) { state[key] = h; picker.value = h; scheduleRender(); }
      });
      hexInput.addEventListener('blur', () => { hexInput.value = state[key]; hexInput.classList.remove('invalid'); });
    };
    syncColor(el.fgColor, el.fgHex, 'fg');
    syncColor(el.bgColor, el.bgHex, 'bg');

    el.transparentBg.addEventListener('change', () => {
      state.transparent = el.transparentBg.checked;
      el.bgColor.disabled = state.transparent; el.bgHex.disabled = state.transparent;
      el.canvasWrap.classList.toggle('checker', state.transparent);
      scheduleRender();
    });
    el.moduleStyle.addEventListener('change', () => { state.style = el.moduleStyle.value; scheduleRender(); });
    el.ecLevel.addEventListener('change', () => { state.ec = el.ecLevel.value; scheduleRender(); });
    el.sizeRange.addEventListener('input', () => {
      state.size = +el.sizeRange.value; el.sizeValue.textContent = String(state.size); scheduleRender();
    });
    el.marginRange.addEventListener('input', () => {
      state.margin = +el.marginRange.value; el.marginValue.textContent = String(state.margin); scheduleRender();
    });

    el.logoBtn.addEventListener('click', onLogoButton);
    el.logoInput.addEventListener('change', onLogoFile);
    el.logoRemove.addEventListener('click', removeLogo);

    el.btnPng.addEventListener('click', downloadPng);
    el.btnSvg.addEventListener('click', downloadSvg);
    el.btnCopyImg.addEventListener('click', copyImage);
    el.btnCopyContent.addEventListener('click', copyContent);
    el.btnBatch.addEventListener('click', runBatch);

    document.addEventListener('pro:changed', refreshUI);
  }

  function applyStateToControls() {
    writeFieldsToDOM();
    el.fgColor.value = state.fg; el.fgHex.value = state.fg;
    el.bgColor.value = state.bg; el.bgHex.value = state.bg;
    el.transparentBg.checked = state.transparent;
    el.bgColor.disabled = state.transparent; el.bgHex.disabled = state.transparent;
    el.canvasWrap.classList.toggle('checker', state.transparent);
    el.moduleStyle.value = state.style;
    el.ecLevel.value = state.ec;
    el.sizeRange.value = String(state.size); el.sizeValue.textContent = String(state.size);
    el.marginRange.value = String(state.margin); el.marginValue.textContent = String(state.margin);
  }

  function init() {
    if (typeof window.qrcode !== 'function') {
      el.qrMeta.textContent = 'The QR library failed to load. Check your connection and reload the page.';
      el.qrMeta.classList.add('warn');
      [el.btnPng, el.btnSvg, el.btnCopyImg].forEach((b) => { b.disabled = true; });
      return;
    }
    load();
    applyStateToControls();
    bind();
    refreshUI();           // sets slider max + prices, schedules a render
    setType(state.type, false);
    track('generate', { type: state.type });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
