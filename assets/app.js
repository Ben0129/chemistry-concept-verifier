/* 學測化學刷題站：單頁應用（不需框架、不需伺服器）
 * 資料來源：assets/data.js（由 tools/build_data.py 從 data/*.json 產生）
 * 路由：#/  #/kb  #/kb/<unit>[/<topic>]  #/code/<code>  #/practice  #/practice/run
 *       #/exam  #/exam/<unit>/<bankKey>  #/exam/mix  #/exam/run  #/review  #/stats
 */
(function () {
  "use strict";

  const D = window.CHEM_DATA;
  const app = document.getElementById("app");
  const LETTERS = ["A", "B", "C", "D", "E"];
  const LEVELS = ["易", "中", "難"];
  const BANK_PROFILE = {
    E: { single: 6, multi: 10, mixed: [10, 10, 10] },
    M: { single: 5, multi: 10, mixed: [4, 4, 6, 6] },
    H: { single: 5, multi: 10, mixed: [4, 4, 12] },
  };

  // ---------- 文字標記 ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function md(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/_\{([^}]*)\}/g, "<sub>$1</sub>")
      .replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>")
      .replace(/\n/g, "<br>");
  }
  const plain = (s) => String(s).replace(/\*\*/g, "").replace(/[_^]\{([^}]*)\}/g, "$1");
  const splitCodes = (s) => String(s).split(/[、,，\s]+/).filter(Boolean);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // ---------- 索引 ----------
  const units = D.knowledge;
  const unitById = Object.fromEntries(units.map((u) => [u.id, u]));
  const codeInfo = {};
  D.curriculum.codes.forEach((c) => (codeInfo[c.code] = { ...c, topics: [], questions: [], mixed: [] }));
  const topicById = {};
  units.forEach((u) => u.topics.forEach((t) => {
    topicById[t.id] = { ...t, unit: u };
    t.codes.forEach((c) => codeInfo[c] && codeInfo[c].topics.push(topicById[t.id]));
  }));

  const questions = []; // 選擇題
  const mixeds = []; // 混合題組
  const banks = []; // 每份題庫
  D.questions.forEach((file) => {
    file.banks.forEach((bank) => {
      const P = bank.points || BANK_PROFILE[bank.key[0]] || BANK_PROFILE.M;
      const singles = bank.questions.filter((q) => q.type === "單選");
      const multis = bank.questions.filter((q) => q.type === "多選");
      const b = { unitId: file.unit_id, key: bank.key, name: bank.name, title: bank.title, P, singles, multis, mixed: bank.mixed || null };
      banks.push(b);
      [...singles, ...multis].forEach((q) => {
        q.unitId = file.unit_id; q.bankKey = bank.key; q.bankName = bank.name;
        q.codes = splitCodes(q.code);
        questions.push(q);
        q.codes.forEach((c) => codeInfo[c] && codeInfo[c].questions.push(q));
      });
      if (bank.mixed) {
        const m = bank.mixed;
        m.unitId = file.unit_id; m.bankKey = bank.key; m.bankName = bank.name; m.points = P.mixed;
        m.codes = splitCodes(m.code);
        mixeds.push(m);
        m.codes.forEach((c) => codeInfo[c] && codeInfo[c].mixed.push(m));
      }
    });
  });
  const qById = Object.fromEntries(questions.map((q) => [q.id, q]));
  const mixedById = Object.fromEntries(mixeds.map((m) => [m.id, m]));
  const unitTitle = (id) => (unitById[id] ? `${unitById[id].order}. ${unitById[id].title}` : id);

  // ---------- 儲存 ----------
  const STORE_KEY = "chem-gsat-v1";
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return { attempts: s.attempts || {}, exams: s.exams || [], wrong: s.wrong || {}, star: s.star || {} };
    } catch (e) {
      return { attempts: {}, exams: [], wrong: {}, star: {} };
    }
  }
  let store = loadStore();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 私密模式等情況：只保留在記憶體 */ }
  }
  function recordAttempt(q, ratio) {
    const a = store.attempts[q.id] || { n: 0, c: 0 };
    a.n += 1;
    if (ratio === 1) a.c += 1;
    a.last = ratio;
    a.t = Date.now();
    store.attempts[q.id] = a;
    if (ratio === 1) delete store.wrong[q.id];
    else store.wrong[q.id] = Date.now();
    save();
  }
  const sessionGet = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const sessionSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } };

  // ---------- 評分 ----------
  // 單選：對 1、錯 0；多選：依學測規則，錯 1 個選項 0.6、錯 2 個 0.2、更多或未作答 0
  function grade(q, picked) {
    const sel = new Set(picked || []);
    if (q.type === "單選") return sel.size === 1 && sel.has(q.answer) ? 1 : 0;
    if (sel.size === 0) return 0;
    let wrong = 0;
    LETTERS.forEach((L) => { if (sel.has(L) !== q.answer.includes(L)) wrong++; });
    return [1, 0.6, 0.2][wrong] ?? 0;
  }

  // ---------- 亂數 ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 共用元件 ----------
  const levelChip = (lv) => `<span class="chip lv-${lv}">${lv}</span>`;
  const codeChips = (codes) => codes.map((c) => `<a class="chip" href="#/code/${encodeURIComponent(c)}" title="${esc(codeInfo[c] ? codeInfo[c].text : "")}">${esc(c)}</a>`).join(" ");
  function dataTable(rows) {
    if (!rows || !rows.length) return "";
    const [head, ...body] = rows;
    return `<div class="tbl-wrap"><table class="data"><thead><tr>${head.map((h) => `<th>${md(h)}</th>`).join("")}</tr></thead>
      <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${md(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const qImage = (q) => (q.image ? `<img class="q-img" src="data/img/${esc(q.image)}" alt="題目附圖" style="width:${q.imgw || 240}px">` : "");
  function relatedTopicsHtml(codes) {
    const seen = new Set(), links = [];
    codes.forEach((c) => (codeInfo[c] ? codeInfo[c].topics : []).forEach((t) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      links.push(`<a href="#/kb/${t.unit.id}/${t.id}">${esc(t.unit.title)}：${esc(t.title)}</a>`);
    }));
    return links.length ? `<div class="small muted" style="margin-top:8px">相關知識點：${links.join("、")}</div>` : "";
  }
  function accuracyOf(qs) {
    let done = 0, correct = 0;
    qs.forEach((q) => { const a = store.attempts[q.id]; if (a) { done++; if (a.last === 1) correct++; } });
    return { done, correct, total: qs.length };
  }

  // ---------- 首頁 ----------
  function viewHome() {
    const acc = accuracyOf(questions);
    const wrongN = Object.keys(store.wrong).filter((id) => qById[id]).length;
    const nTopics = units.reduce((a, u) => a + u.topics.length, 0);
    app.innerHTML = `
      <section class="card hero">
        <h1>學測化學刷題站</h1>
        <p class="muted">依 108 課綱部定必修化學編寫。先讀知識庫建立觀念，再分單元刷題，最後用模擬試題檢驗。每一題都標註學習內容代碼，答錯可直接跳回相關知識點。</p>
        <div class="row" style="margin-top:12px">
          <a class="btn primary" href="#/practice">開始刷題</a>
          <a class="btn" href="#/kb">讀知識庫</a>
          <a class="btn" href="#/exam">做一份模擬試題</a>
        </div>
      </section>
      <div class="stat-row">
        <div class="stat"><div class="num">${units.length}</div><div class="lbl">知識庫單元（${nTopics} 個主題）</div></div>
        <div class="stat"><div class="num">${questions.length}</div><div class="lbl">選擇題</div></div>
        <div class="stat"><div class="num">${mixeds.length}</div><div class="lbl">混合題組</div></div>
        <div class="stat"><div class="num">${acc.done}</div><div class="lbl">已作答題數</div></div>
        <div class="stat"><div class="num">${acc.done ? pct(acc.correct, acc.done) + "%" : "—"}</div><div class="lbl">最近一次作答正確率</div></div>
        <div class="stat"><div class="num">${wrongN}</div><div class="lbl">錯題本</div></div>
      </div>
      <h2>單元</h2>
      <div class="grid">${units.map((u) => {
        const qs = questions.filter((q) => q.unitId === u.id), a = accuracyOf(qs);
        return `<div class="card">
          <div class="muted small">第 ${u.order} 單元・${esc(u.subunits.split("、")[0])}</div>
          <h3 style="margin:2px 0 6px"><a href="#/kb/${u.id}">${esc(u.title)}</a></h3>
          <div class="small muted">${u.topics.length} 個主題・${qs.length} 題</div>
          <div class="progress-mini" style="margin:8px 0" title="已作答 ${a.done}/${a.total}"><span style="width:${pct(a.done, a.total)}%"></span></div>
          <div class="row"><a class="btn sm" href="#/kb/${u.id}">知識</a>${qs.length ? `<a class="btn sm" href="#/practice?unit=${u.id}">刷題</a>` : ""}</div>
        </div>`;
      }).join("")}</div>`;
  }

  // ---------- 知識庫 ----------
  function topicHtml(t, query) {
    const hi = (html) => (query ? highlight(html, query) : html);
    const qs = [...new Set(t.codes.flatMap((c) => (codeInfo[c] ? codeInfo[c].questions : [])))];
    const a = accuracyOf(qs);
    return `<section class="card topic" id="${t.id}">
      <h2>${esc(t.title)}</h2>
      <div class="chips" style="margin-bottom:8px">${codeChips(t.codes)}</div>
      <ul class="points">${t.points.map((p) => `<li>${hi(md(p))}</li>`).join("")}</ul>
      ${t.table ? dataTable(t.table) : ""}
      ${t.formulas && t.formulas.length ? `<div class="box formula"><h4>公式</h4>${t.formulas.map((f) => `<div><strong>${md(f.name)}</strong>：${md(f.expr)}</div>`).join("")}</div>` : ""}
      ${t.misconceptions && t.misconceptions.length ? `<div class="box mis"><h4>常見迷思</h4>${t.misconceptions.map((m) => `<div class="mis-item"><div class="w">✗ ${hi(md(m.wrong))}</div><div class="r">✓ ${hi(md(m.right))}</div></div>`).join("")}</div>` : ""}
      ${t.exam_tips && t.exam_tips.length ? `<div class="box tip"><h4>學測考點</h4>${t.exam_tips.map((x) => `<div>${hi(md(x))}</div>`).join("")}</div>` : ""}
      ${qs.length ? `<div class="row small" style="margin-top:10px"><span class="muted">相關題目 ${qs.length} 題，已作答 ${a.done} 題${a.done ? `，正確 ${a.correct} 題` : ""}</span><span class="spacer"></span>
        <a class="btn sm" href="#/practice?codes=${encodeURIComponent(t.codes.join(","))}">練習這個主題</a></div>` : ""}
    </section>`;
  }
  function highlight(html, query) {
    const q = esc(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 只替換標籤外的文字
    return html.replace(/(^|>)([^<]+)/g, (m, p, text) => p + text.replace(new RegExp(q, "g"), (x) => `<mark>${x}</mark>`));
  }
  function topicText(t) {
    return plain([t.title, ...t.points, ...(t.exam_tips || []), ...(t.misconceptions || []).flatMap((m) => [m.wrong, m.right]),
      ...(t.formulas || []).flatMap((f) => [f.name, f.expr]), ...(t.table || []).flat(), ...t.codes].join(" "));
  }
  function viewKbIndex(query) {
    query = (query || "").trim();
    let results = "";
    if (query) {
      const hits = Object.values(topicById).filter((t) => topicText(t).includes(query));
      results = `<h2>搜尋「${esc(query)}」：${hits.length} 個主題</h2>` +
        (hits.length ? hits.map((t) => `<div class="muted small">${esc(t.unit.title)}</div>${topicHtml(t, query)}`).join("") : `<div class="empty">找不到相關內容，試試其他關鍵字（例如：莫耳、pH、萃取）。</div>`);
    }
    app.innerHTML = `
      <h1>知識庫</h1>
      <p class="muted">依單元整理的重點、公式、常見迷思與學測考點。點學習內容代碼可看到該條目的所有知識點與題目。</p>
      <div class="card"><input type="search" id="kbSearch" placeholder="搜尋知識點，例如：限量試劑、R_f、酸雨" value="${esc(query)}" aria-label="搜尋知識庫"></div>
      ${results || `
      <div class="grid">${units.map((u) => `<div class="card">
        <div class="muted small">第 ${u.order} 單元</div>
        <h3 style="margin:2px 0 6px"><a href="#/kb/${u.id}">${esc(u.title)}</a></h3>
        <p class="small muted">${md(u.summary)}</p>
        <ul class="small" style="padding-left:1.2em;margin:6px 0 0">${u.topics.map((t) => `<li><a href="#/kb/${u.id}/${t.id}">${esc(t.title)}</a></li>`).join("")}</ul>
      </div>`).join("")}</div>
      <h2>學習內容代碼總覽</h2>
      <div class="card">${codeIndexHtml()}</div>
      <h2>學測不考（選修）</h2>
      <div class="card small"><ul style="padding-left:1.2em;margin:0">${D.curriculum.not_tested.map((x) => `<li>${md(x)}</li>`).join("")}</ul>
      <p class="muted">${md(D.curriculum.note)}</p></div>`}`;
    const input = document.getElementById("kbSearch");
    let timer;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        history.replaceState(null, "", "#/kb" + (input.value.trim() ? "?q=" + encodeURIComponent(input.value.trim()) : ""));
        viewKbIndex(input.value);
        const el = document.getElementById("kbSearch");
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 250);
    });
  }
  function codeIndexHtml() {
    return D.curriculum.themes.map((th) => {
      const cs = D.curriculum.codes.filter((c) => c.theme === th.id);
      return `<h3 style="margin-top:12px">${esc(th.name)}</h3>
        <table class="list"><tbody>${cs.map((c) => {
          const info = codeInfo[c.code];
          return `<tr><td style="width:110px"><a href="#/code/${encodeURIComponent(c.code)}">${c.code}</a></td><td>${md(c.text)}</td>
            <td class="muted small" style="width:110px;text-align:right">${info.topics.length} 主題・${info.questions.length + info.mixed.length} 題</td></tr>`;
        }).join("")}</tbody></table>`;
    }).join("");
  }
  function viewKbUnit(uid, tid) {
    const u = unitById[uid];
    if (!u) return notFound();
    const qs = questions.filter((q) => q.unitId === uid);
    app.innerHTML = `
      <div class="small"><a href="#/kb">知識庫</a> ／ 第 ${u.order} 單元</div>
      <h1>${esc(u.title)}</h1>
      <p class="muted">${esc(u.subunits)}</p>
      <p>${md(u.summary)}</p>
      <div class="row" style="margin-bottom:16px">
        ${qs.length ? `<a class="btn primary" href="#/practice?unit=${uid}">刷本單元 ${qs.length} 題</a><a class="btn" href="#/exam">本單元模擬試題</a>` : `<span class="muted small">本單元題庫建置中。</span>`}
      </div>
      <div class="kb-layout">
        <nav class="toc card" aria-label="主題目錄">${u.topics.map((t, i) => `<a href="#/kb/${uid}/${t.id}">${i + 1}. ${esc(t.title)}</a>`).join("")}</nav>
        <div>${u.topics.map((t) => topicHtml(topicById[t.id])).join("")}
          <div class="row">${u.order > 1 ? `<a class="btn" href="#/kb/${units[u.order - 2].id}">← ${esc(units[u.order - 2].title)}</a>` : ""}<span class="spacer"></span>
          ${units[u.order] ? `<a class="btn" href="#/kb/${units[u.order].id}">${esc(units[u.order].title)} →</a>` : ""}</div>
        </div>
      </div>`;
    if (tid) {
      const el = document.getElementById(tid);
      if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 0);
    }
  }
  function viewCode(code) {
    const info = codeInfo[code];
    if (!info) return notFound();
    const all = info.questions;
    const a = accuracyOf(all);
    app.innerHTML = `
      <div class="small"><a href="#/kb">知識庫</a> ／ 學習內容</div>
      <h1>${esc(code)}</h1>
      <p>${md(info.text)}</p>
      <div class="row" style="margin-bottom:12px">
        ${all.length ? `<a class="btn primary" href="#/practice?codes=${encodeURIComponent(code)}">練習相關的 ${all.length} 題</a>` : ""}
        <span class="muted small">${all.length ? `已作答 ${a.done} 題，正確 ${a.correct} 題` : "尚無相關選擇題"}${info.mixed.length ? `；另有 ${info.mixed.length} 組混合題` : ""}</span>
      </div>
      ${info.topics.map((t) => `<div class="muted small">${esc(t.unit.title)}</div>${topicHtml(t)}`).join("") || `<div class="empty">尚無知識點。</div>`}`;
  }

  // ---------- 刷題 ----------
  function parseQuery(qs) {
    const out = {};
    (qs || "").split("&").filter(Boolean).forEach((kv) => {
      const [k, v] = kv.split("=");
      out[decodeURIComponent(k)] = decodeURIComponent(v || "");
    });
    return out;
  }
  function viewPracticeSetup(params) {
    const pre = params.unit ? [params.unit] : null;
    const codes = params.codes ? params.codes.split(",") : null;
    if (codes) {
      const pool = questions.filter((q) => q.codes.some((c) => codes.includes(c)));
      return startPractice(pool, `學習內容 ${codes.join("、")}`, { shuffle: true, replace: true });
    }
    const unitsWithQ = units.filter((u) => questions.some((q) => q.unitId === u.id));
    if (!unitsWithQ.length) {
      app.innerHTML = `<h1>刷題練習</h1><div class="empty card">題庫建置中，請先閱讀<a href="#/kb">知識庫</a>。</div>`;
      return;
    }
    app.innerHTML = `
      <h1>刷題練習</h1>
      <p class="muted">一次一題，作答後立即顯示答案與詳解。多選題依學測規則計分：錯 1 個選項得 60%，錯 2 個得 20%。</p>
      <form class="card" id="pf">
        <fieldset><legend>單元</legend>
          ${unitsWithQ.map((u) => `<label class="check"><input type="checkbox" name="unit" value="${u.id}" ${!pre || pre.includes(u.id) ? "checked" : ""}> ${esc(u.title)}
            <span class="muted small">（${questions.filter((q) => q.unitId === u.id).length}）</span></label>`).join("")}
          <div><button type="button" class="btn sm" data-all="unit">全選</button> <button type="button" class="btn sm" data-none="unit">全不選</button></div>
        </fieldset>
        <fieldset><legend>難度</legend>
          ${LEVELS.map((l) => `<label class="check"><input type="checkbox" name="level" value="${l}" checked> ${l}</label>`).join("")}
        </fieldset>
        <fieldset><legend>題型</legend>
          <label class="check"><input type="checkbox" name="type" value="單選" checked> 單選</label>
          <label class="check"><input type="checkbox" name="type" value="多選" checked> 多選</label>
        </fieldset>
        <fieldset><legend>範圍</legend>
          <label class="check"><input type="radio" name="scope" value="all" checked> 全部題目</label>
          <label class="check"><input type="radio" name="scope" value="new"> 只做沒做過的</label>
          <label class="check"><input type="radio" name="scope" value="wrong"> 只做錯題本</label>
        </fieldset>
        <fieldset><legend>題數與順序</legend>
          <select name="count" aria-label="題數"><option value="10">10 題</option><option value="20" selected>20 題</option><option value="40">40 題</option><option value="0">全部</option></select>
          <label class="check"><input type="checkbox" name="shuffle" checked> 隨機出題</label>
        </fieldset>
        <div class="row"><button class="btn primary" type="submit">開始練習</button><span class="muted small" id="poolInfo"></span></div>
      </form>`;
    const form = document.getElementById("pf");
    const pick = () => {
      const fd = new FormData(form);
      const us = fd.getAll("unit"), ls = fd.getAll("level"), ts = fd.getAll("type"), scope = fd.get("scope");
      return questions.filter((q) => us.includes(q.unitId) && ls.includes(q.level) && ts.includes(q.type) &&
        (scope === "all" || (scope === "new" && !store.attempts[q.id]) || (scope === "wrong" && store.wrong[q.id])));
    };
    const info = () => { document.getElementById("poolInfo").textContent = `符合條件：${pick().length} 題`; };
    form.addEventListener("change", info);
    form.addEventListener("click", (e) => {
      const all = e.target.getAttribute("data-all"), none = e.target.getAttribute("data-none");
      if (all || none) { form.querySelectorAll(`input[name="${all || none}"]`).forEach((i) => (i.checked = !!all)); info(); }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const pool = pick();
      if (!pool.length) { info(); return; }
      startPractice(pool, "自選練習", { shuffle: !!fd.get("shuffle"), count: +fd.get("count") });
    });
    info();
  }
  function startPractice(pool, title, opt) {
    let ids = pool.map((q) => q.id);
    if (opt.shuffle) ids = shuffle(ids);
    if (opt.count) ids = ids.slice(0, opt.count);
    if (!ids.length) {
      app.innerHTML = `<h1>刷題練習</h1><div class="empty card">沒有符合條件的題目。<a href="#/practice">回到設定</a></div>`;
      return;
    }
    sessionSet("practice", { title, ids, i: 0, answers: {}, scores: {} });
    if (location.hash === "#/practice/run") viewPracticeRun();
    else if (opt.replace) location.replace("#/practice/run");
    else location.hash = "#/practice/run";
  }
  function viewPracticeRun() {
    const s = sessionGet("practice");
    if (!s) { location.hash = "#/practice"; return; }
    if (s.i >= s.ids.length) return practiceSummary(s);
    const q = qById[s.ids[s.i]];
    if (!q) { s.i++; sessionSet("practice", s); return viewPracticeRun(); }
    const done = s.scores[q.id] !== undefined;
    const picked = new Set(s.answers[q.id] || []);
    const answered = Object.keys(s.scores).length;
    const got = Object.values(s.scores).reduce((a, b) => a + b, 0);
    app.innerHTML = `
      <div class="row small"><a href="#/practice">← 練習設定</a><span class="spacer"></span><span class="muted">${esc(s.title)}・第 ${s.i + 1} / ${s.ids.length} 題・得分率 ${answered ? pct(got, answered) : 0}%</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${s.i}" aria-valuemax="${s.ids.length}"><span style="width:${pct(s.i, s.ids.length)}%"></span></div>
      <article class="card">${questionHtml(q, picked, done ? q.answer : null, { num: s.i + 1, interactive: !done })}
        ${done ? resultHtml(q, s.scores[q.id]) : ""}
        <div class="row" style="margin-top:14px">
          ${s.i > 0 ? `<button class="btn" id="prev">上一題</button>` : ""}
          <span class="spacer"></span>
          <button class="btn ${store.star[q.id] ? "primary" : ""}" id="star" title="收藏到錯題本，方便日後複習">${store.star[q.id] ? "★ 已收藏" : "☆ 收藏"}</button>
          ${done ? `<button class="btn primary" id="next">${s.i + 1 < s.ids.length ? "下一題" : "看結果"}</button>` : `<button class="btn primary" id="submit" ${picked.size ? "" : "disabled"}>送出答案</button>`}
        </div>
      </article>`;
    bindOptions(q, picked, !done, () => {
      s.answers[q.id] = [...picked].sort();
      sessionSet("practice", s);
      const btn = document.getElementById("submit");
      if (btn) btn.disabled = !picked.size;
    });
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    on("submit", () => {
      const r = grade(q, [...picked]);
      s.scores[q.id] = r;
      sessionSet("practice", s);
      recordAttempt(q, r);
      viewPracticeRun();
    });
    on("next", () => { s.i++; sessionSet("practice", s); viewPracticeRun(); window.scrollTo(0, 0); });
    on("prev", () => { s.i--; sessionSet("practice", s); viewPracticeRun(); });
    on("star", () => { if (store.star[q.id]) delete store.star[q.id]; else store.star[q.id] = Date.now(); save(); viewPracticeRun(); });
  }
  function questionHtml(q, picked, reveal, o) {
    const pickedSet = picked instanceof Set ? picked : new Set(picked || []);
    return `<div class="q-head">
        <span class="chip">${q.type}</span>${levelChip(q.level)}<span class="chip">${esc(unitById[q.unitId] ? unitById[q.unitId].title : q.unitId)}</span>
        ${codeChips(q.codes)}<span class="muted small">${esc(q.id)}</span>
      </div>
      <div class="q-stem">${o.num ? `<span class="q-num">${o.num}.</span>` : ""}${md(q.stem)}</div>
      ${qImage(q)}${dataTable(q.table)}
      ${q.type === "多選" && !reveal ? `<div class="small muted" style="margin-bottom:6px">多選題：可選一個或多個選項。</div>` : ""}
      <div class="opts" data-q="${esc(q.id)}">${q.options.map((op, i) => {
        const L = LETTERS[i];
        let cls = pickedSet.has(L) ? "sel" : "";
        if (reveal) cls = q.answer.includes(L) ? "right" : pickedSet.has(L) ? "wrong" : "";
        return `<button type="button" class="opt ${cls}" data-l="${L}" ${o.interactive ? "" : "disabled"} aria-pressed="${pickedSet.has(L)}">
          <span class="lt">${L}</span><span>${md(op)}</span></button>`;
      }).join("")}</div>`;
  }
  function bindOptions(q, picked, interactive, onChange, root) {
    if (!interactive) return;
    (root || app).querySelectorAll(`.opts[data-q="${CSS.escape(q.id)}"] .opt`).forEach((btn) => {
      btn.addEventListener("click", () => {
        const L = btn.dataset.l;
        if (q.type === "單選") { picked.clear(); picked.add(L); }
        else if (picked.has(L)) picked.delete(L);
        else picked.add(L);
        btn.parentElement.querySelectorAll(".opt").forEach((b) => {
          b.classList.toggle("sel", picked.has(b.dataset.l));
          b.setAttribute("aria-pressed", picked.has(b.dataset.l));
        });
        onChange();
      });
    });
  }
  function resultHtml(q, r) {
    const cls = r === 1 ? "ok" : r > 0 ? "part" : "bad";
    const verdict = r === 1 ? "答對了！" : r > 0 ? `部分正確（得 ${Math.round(r * 100)}%）` : "答錯了";
    return `<div class="result ${cls}">
      <div class="verdict">${verdict}　正確答案：${q.answer.split("").map((x) => `(${x})`).join("")}</div>
      <div class="explain">${md(q.explain)}</div>
      ${relatedTopicsHtml(q.codes)}
    </div>`;
  }
  function practiceSummary(s) {
    const ids = s.ids.filter((id) => s.scores[id] !== undefined);
    const got = ids.reduce((a, id) => a + s.scores[id], 0);
    const wrong = ids.filter((id) => s.scores[id] < 1);
    const byCode = {};
    wrong.forEach((id) => qById[id].codes.forEach((c) => (byCode[c] = (byCode[c] || 0) + 1)));
    const weak = Object.entries(byCode).sort((a, b) => b[1] - a[1]).slice(0, 5);
    app.innerHTML = `
      <h1>練習結果</h1>
      <div class="card">
        <div class="score-big">${pct(got, ids.length)}%</div>
        <div class="muted">${esc(s.title)}・共 ${ids.length} 題，全對 ${ids.length - wrong.length} 題</div>
        ${weak.length ? `<h3 style="margin-top:14px">建議複習</h3><ul>${weak.map(([c, n]) => `<li><a href="#/code/${encodeURIComponent(c)}">${c}</a>：${md(codeInfo[c] ? codeInfo[c].text : "")}（錯 ${n} 題）</li>`).join("")}</ul>` : ""}
        <div class="row" style="margin-top:12px">
          ${wrong.length ? `<button class="btn primary" id="redo">重做這次的錯題（${wrong.length}）</button>` : ""}
          <a class="btn" href="#/practice">再練一組</a><a class="btn" href="#/review">錯題本</a>
        </div>
      </div>
      <h2>逐題回顧</h2>
      ${s.ids.map((id, i) => { const q = qById[id]; if (!q) return ""; return `<details class="card"><summary>${i + 1}. ${s.scores[id] === 1 ? "✓" : s.scores[id] > 0 ? "△" : "✗"} ${esc(plain(q.stem).slice(0, 60))}…</summary>
        ${questionHtml(q, s.answers[id], q.answer, { num: i + 1 })}${s.scores[id] !== undefined ? resultHtml(q, s.scores[id]) : ""}</details>`; }).join("")}`;
    const r = document.getElementById("redo");
    if (r) r.addEventListener("click", () => startPractice(wrong.map((id) => qById[id]), "重做錯題", { shuffle: false }));
  }

  // ---------- 模擬試題 ----------
  function viewExamList() {
    const bestOf = (id) => store.exams.filter((e) => e.id === id).reduce((m, e) => Math.max(m, pct(e.score, e.max)), -1);
    const byUnit = units.map((u) => ({ u, bs: banks.filter((b) => b.unitId === u.id) })).filter((x) => x.bs.length);
    app.innerHTML = `
      <h1>模擬試題</h1>
      <p class="muted">每份單元試卷比照學測題型：單選、多選與混合題（非選擇題）組成，滿分 100 分。混合題交卷後對照參考答案與評分規準自評。</p>
      <section class="card">
        <h2 style="margin-top:0">綜合模擬卷</h2>
        <p class="small muted">從所選單元隨機抽題組卷，模擬學測化學部分的跨單元作答。</p>
        <form id="mixf">
          <fieldset><legend>範圍</legend>${byUnit.map(({ u }) => `<label class="check"><input type="checkbox" name="unit" value="${u.id}" checked> ${esc(u.title)}</label>`).join("")}</fieldset>
          <fieldset><legend>難度</legend>
            <label class="check"><input type="radio" name="mode" value="basic"> 基礎（易題為主）</label>
            <label class="check"><input type="radio" name="mode" value="std" checked> 標準（接近學測）</label>
            <label class="check"><input type="radio" name="mode" value="hard"> 挑戰（中難題為主）</label>
          </fieldset>
          <div class="row"><button class="btn primary" type="submit">產生試卷（10 單選＋5 多選＋1 混合題組，滿分 100）</button></div>
        </form>
      </section>
      <h2>單元試卷</h2>
      ${byUnit.length ? `<div class="grid">${byUnit.map(({ u, bs }) => `<div class="card">
        <div class="muted small">第 ${u.order} 單元</div><h3 style="margin:2px 0">${esc(u.title)}</h3>
        <div class="bank-cell">${bs.map((b) => { const best = bestOf(`${u.id}/${b.key}`); return `<a class="btn sm" href="#/exam/${u.id}/${encodeURIComponent(b.key)}">${esc(b.name)}卷${best >= 0 ? `<span class="muted">（${best}）</span>` : ""}</a>`; }).join("")}</div>
      </div>`).join("")}</div>` : `<div class="empty card">題庫建置中。</div>`}
      ${store.exams.length ? `<h2>最近的考試紀錄</h2><div class="card">${examHistoryHtml(8)}</div>` : ""}`;
    const f = document.getElementById("mixf");
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const us = fd.getAll("unit");
      if (!us.length) return;
      buildMixExam(us, fd.get("mode"));
    });
  }
  function examHistoryHtml(n) {
    return `<table class="list"><thead><tr><th>日期</th><th>試卷</th><th>得分</th><th>用時</th></tr></thead><tbody>${store.exams.slice(-n).reverse().map((e) =>
      `<tr><td>${new Date(e.date).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(e.title)}</td>
       <td>${e.score} / ${e.max}（${pct(e.score, e.max)}%）</td><td>${Math.round(e.sec / 60)} 分</td></tr>`).join("")}</tbody></table>`;
  }
  function startBankExam(uid, key) {
    const b = banks.find((x) => x.unitId === uid && x.key === key);
    if (!b) return notFound();
    const cur = sessionGet("exam");
    if (cur && cur.id === `${uid}/${key}` && !cur.submitted) { location.replace("#/exam/run"); return; }
    const items = [
      ...b.singles.map((q) => ({ id: q.id, pts: b.P.single })),
      ...b.multis.map((q) => ({ id: q.id, pts: b.P.multi })),
    ];
    const exam = { id: `${uid}/${key}`, title: `${unitById[uid].title}（${b.name}）`, items, mixed: b.mixed ? [b.mixed.id] : [],
      minutes: 50, start: Date.now(), answers: {}, mixedText: {}, submitted: false };
    sessionSet("exam", exam);
    location.replace("#/exam/run");
  }
  function buildMixExam(us, mode) {
    const weights = { basic: { 易: 0.6, 中: 0.35, 難: 0.05 }, std: { 易: 0.3, 中: 0.5, 難: 0.2 }, hard: { 易: 0.1, 中: 0.45, 難: 0.45 } }[mode] || { 易: 0.3, 中: 0.5, 難: 0.2 };
    const pool = questions.filter((q) => us.includes(q.unitId));
    const drawType = (type, n) => {
      const out = [];
      const byLv = {};
      LEVELS.forEach((l) => (byLv[l] = shuffle(pool.filter((q) => q.type === type && q.level === l))));
      // 依權重決定每題難度，該難度沒題目時從其他難度補
      for (let i = 0; i < n; i++) {
        let r = Math.random(), lv = "中";
        for (const l of LEVELS) { if (r < weights[l]) { lv = l; break; } r -= weights[l]; }
        const order = [lv, ...LEVELS.filter((l) => l !== lv)];
        const from = order.find((l) => byLv[l].length);
        if (!from) break;
        out.push(byLv[from].pop());
      }
      // 盡量讓單元分散：依單元順序排列
      return out.sort((a, b) => unitById[a.unitId].order - unitById[b.unitId].order);
    };
    // 配分：單選 10 題 × 4 分；混合題保留原配分（易 30、中難 20）；多選 5 題平分剩下的分數，使總分為 100
    const singles = drawType("單選", 10), multis = drawType("多選", 5);
    const mxPool = mixeds.filter((m) => us.includes(m.unitId));
    const prefer = mxPool.filter((m) => (mode === "basic" ? m.level === "易" : mode === "hard" ? m.level === "難" : m.level === "中"));
    const mx = shuffle(prefer.length ? prefer : mxPool)[0];
    const mxTotal = mx ? mx.points.reduce((a, b) => a + b, 0) : 0;
    const multiPts = multis.length ? (100 - 4 * singles.length - mxTotal) / multis.length : 0;
    const items = [...singles.map((q) => ({ id: q.id, pts: 4 })), ...multis.map((q) => ({ id: q.id, pts: multiPts }))];
    const exam = { id: "mix", title: `綜合模擬卷（${{ basic: "基礎", std: "標準", hard: "挑戰" }[mode]}）`, items, mixed: mx ? [mx.id] : [],
      minutes: 60, start: Date.now(), answers: {}, mixedText: {}, submitted: false };
    sessionSet("exam", exam);
    location.hash = "#/exam/run";
  }
  let timerHandle = null;
  function viewExamRun() {
    const ex = sessionGet("exam");
    if (!ex) { location.hash = "#/exam"; return; }
    const singles = ex.items.filter((it) => qById[it.id] && qById[it.id].type === "單選");
    const multis = ex.items.filter((it) => qById[it.id] && qById[it.id].type === "多選");
    const mxs = ex.mixed.map((id) => mixedById[id]).filter(Boolean);
    const S = ex.submitted;
    let n = 0;
    const qBlock = (it) => {
      const q = qById[it.id]; n++;
      const picked = ex.answers[q.id] || [];
      const r = S ? grade(q, picked) : null;
      return `<div class="exam-q" id="eq-${n}">
        ${questionHtml(q, picked, S ? q.answer : null, { num: n, interactive: !S })}
        ${S ? `<div class="small" style="margin-top:6px"><strong>得分 ${+(r * it.pts).toFixed(1)} / ${it.pts}</strong></div>${resultHtml(q, r)}` : ""}
      </div>`;
    };
    const mixedTotal = mxs.reduce((a, m) => a + m.points.reduce((x, y) => x + y, 0), 0);
    // 題號依卷面順序：單選 → 多選 → 混合題
    const singlesHtml = singles.map(qBlock).join("");
    const multisHtml = multis.map(qBlock).join("");
    let mixedHtml = "";
    mxs.forEach((m) => {
      mixedHtml += `<div class="exam-q"><div class="q-head">${levelChip(m.level)}${codeChips(m.codes)}<span class="muted small">${esc(m.id)}</span></div>
        <h3>${md(m.title.replace("混合題：", ""))}</h3><p>${md(m.intro)}</p>${qImage(m)}${dataTable(m.table)}
        ${m.parts.map((p, i) => {
          n++;
          const key = `${m.id}#${i}`, val = ex.mixedText[key] || "";
          const self = (ex.selfScore || {})[key];
          return `<div class="mixed-part" id="eq-${n}"><div><span class="q-num">${n}.</span>${md(p.q)}<span class="muted">（${m.points[i]} 分）</span></div>
            ${S ? `<div class="ref"><div><strong>你的作答：</strong>${val ? esc(val).replace(/\n/g, "<br>") : `<span class="muted">（未作答）</span>`}</div>
              <div style="margin-top:6px"><strong>參考答案：</strong>${md(p.a)}</div>
              <div style="margin-top:6px"><strong>評分規準：</strong>${md(p.rubric)}</div>
              <div class="row" style="margin-top:8px"><label>自評得分 <input type="number" min="0" max="${m.points[i]}" step="1" data-self="${esc(key)}" value="${self ?? ""}" style="width:80px"> / ${m.points[i]}</label></div></div>`
            : `<textarea data-mx="${esc(key)}" placeholder="在此作答（交卷後對照參考答案自評）">${esc(val)}</textarea>`}
          </div>`;
        }).join("")}</div>`;
    });
    const auto = ex.items.reduce((a, it) => a + (qById[it.id] ? grade(qById[it.id], ex.answers[it.id]) * it.pts : 0), 0);
    const selfSum = Object.values(ex.selfScore || {}).reduce((a, b) => a + (+b || 0), 0);
    const max = ex.items.reduce((a, it) => a + it.pts, 0) + mixedTotal;
    const singlePts = singles[0] ? singles[0].pts : 0, multiPts = multis[0] ? multis[0].pts : 0;
    app.innerHTML = `
      <div class="small"><a href="#/exam">模擬試題</a></div>
      <h1>${esc(ex.title)}</h1>
      ${S ? `<div class="card"><div class="score-big">${+(auto + selfSum).toFixed(1)} <span class="muted" style="font-size:1rem">/ ${max}</span></div>
        <div class="muted">選擇題 ${+auto.toFixed(1)} 分${mixedTotal ? `＋混合題自評 ${selfSum} 分（共 ${mixedTotal} 分）` : ""}・用時 ${Math.round((ex.end - ex.start) / 60000)} 分鐘</div>
        <div class="row" style="margin-top:10px"><a class="btn" href="#/exam">回試卷列表</a><button class="btn" id="retake">重新作答</button><a class="btn" href="#/review">錯題本</a></div></div>`
      : `<p class="muted small">建議作答時間 ${ex.minutes} 分鐘。作答會自動暫存，重新整理頁面不會遺失。</p>`}
      <section class="card">
        ${singles.length ? `<div class="exam-sec"><h2 style="margin-top:0">一、單選題（每題 ${singlePts} 分，共 ${singlePts * singles.length} 分）</h2>${singlesHtml}</div>` : ""}
        ${multis.length ? `<div class="exam-sec"><h2>二、多選題（每題 ${multiPts} 分，共 ${multiPts * multis.length} 分）</h2>
          <p class="small muted">每題有 5 個選項，至少有 1 個正確。所有選項均答對得全部分數；答錯 1 個選項得 60%；答錯 2 個得 20%；答錯多於 2 個或未作答得 0 分。</p>${multisHtml}</div>` : ""}
        ${mxs.length ? `<div class="exam-sec"><h2>三、混合題（共 ${mixedTotal} 分）</h2>${mixedHtml}</div>` : ""}
      </section>
      <div class="sticky-bar">
        <div class="sheet">${Array.from({ length: n }, (_, i) => {
          const it = ex.items[i];
          let cls = "";
          if (it) {
            const a = ex.answers[it.id] || [];
            if (S) { const r = grade(qById[it.id], a); cls = r === 1 ? "r" : r > 0 ? "p" : "w"; } else if (a.length) cls = "done";
          }
          return `<a href="#eq-${i + 1}" class="${cls}" data-jump="${i + 1}">${i + 1}</a>`;
        }).join("")}</div>
        <span class="spacer"></span>
        ${S ? "" : `<span class="timer" id="timer"></span><button class="btn primary" id="submitExam">交卷</button>`}
      </div>`;

    // 作答綁定
    if (!S) {
      ex.items.forEach((it) => {
        const q = qById[it.id];
        if (!q) return;
        const picked = new Set(ex.answers[q.id] || []);
        bindOptions(q, picked, true, () => {
          ex.answers[q.id] = [...picked].sort();
          sessionSet("exam", ex);
          const idx = ex.items.indexOf(it) + 1;
          const a = app.querySelector(`.sheet a[data-jump="${idx}"]`);
          if (a) a.classList.toggle("done", picked.size > 0);
        });
      });
      app.querySelectorAll("textarea[data-mx]").forEach((t) => t.addEventListener("input", () => { ex.mixedText[t.dataset.mx] = t.value; sessionSet("exam", ex); }));
      const tick = () => {
        const el = document.getElementById("timer");
        if (!el) { clearInterval(timerHandle); return; }
        const sec = Math.floor((Date.now() - ex.start) / 1000), left = ex.minutes * 60 - sec;
        const f = (x) => String(Math.floor(Math.abs(x) / 60)).padStart(2, "0") + ":" + String(Math.abs(x) % 60).padStart(2, "0");
        el.textContent = left >= 0 ? `剩餘 ${f(left)}` : `超時 ${f(left)}`;
        el.style.color = left < 300 ? "var(--bad)" : "";
      };
      clearInterval(timerHandle);
      tick();
      timerHandle = setInterval(tick, 1000);
      document.getElementById("submitExam").addEventListener("click", () => {
        const unanswered = ex.items.filter((it) => !(ex.answers[it.id] || []).length).length;
        if (unanswered && !confirm(`還有 ${unanswered} 題選擇題沒有作答，確定交卷？`)) return;
        ex.submitted = true;
        ex.end = Date.now();
        ex.selfScore = {};
        ex.items.forEach((it) => qById[it.id] && recordAttempt(qById[it.id], grade(qById[it.id], ex.answers[it.id])));
        const sc = ex.items.reduce((a, it) => a + grade(qById[it.id], ex.answers[it.id]) * it.pts, 0);
        store.exams.push({ id: ex.id, title: ex.title, score: +sc.toFixed(1), max, date: ex.end, sec: Math.round((ex.end - ex.start) / 1000) });
        ex.historyIndex = store.exams.length - 1;
        save();
        sessionSet("exam", ex);
        clearInterval(timerHandle);
        viewExamRun();
        window.scrollTo(0, 0);
      });
    } else {
      app.querySelectorAll("input[data-self]").forEach((inp) => inp.addEventListener("change", () => {
        const mx = +inp.max;
        let v = Math.max(0, Math.min(mx, Math.round(+inp.value || 0)));
        inp.value = v;
        ex.selfScore[inp.dataset.self] = v;
        const total = ex.items.reduce((a, it) => a + grade(qById[it.id], ex.answers[it.id]) * it.pts, 0) + Object.values(ex.selfScore).reduce((a, b) => a + b, 0);
        if (store.exams[ex.historyIndex]) { store.exams[ex.historyIndex].score = +total.toFixed(1); save(); }
        sessionSet("exam", ex);
        viewExamRun();
      }));
      document.getElementById("retake").addEventListener("click", () => {
        Object.assign(ex, { submitted: false, answers: {}, mixedText: {}, selfScore: {}, start: Date.now() });
        delete ex.end; delete ex.historyIndex;
        sessionSet("exam", ex);
        viewExamRun();
        window.scrollTo(0, 0);
      });
    }
    app.querySelectorAll(".sheet a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const el = document.getElementById("eq-" + a.dataset.jump);
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    }));
  }

  // ---------- 錯題本 ----------
  function viewReview() {
    const wrongIds = Object.keys(store.wrong).filter((id) => qById[id]);
    const starIds = Object.keys(store.star).filter((id) => qById[id] && !store.wrong[id]);
    const group = (ids) => units.map((u) => ({ u, qs: ids.map((id) => qById[id]).filter((q) => q.unitId === u.id) })).filter((g) => g.qs.length);
    const listHtml = (ids, kind) => group(ids).map(({ u, qs }) => `<h3>${esc(u.title)}（${qs.length}）</h3>${qs.map((q) => `
      <details class="card"><summary>${levelChip(q.level)} ${esc(plain(q.stem).slice(0, 70))}…</summary>
        ${questionHtml(q, [], q.answer, {})}${resultHtml(q, store.attempts[q.id] ? store.attempts[q.id].last : 0)}
        <div class="row" style="margin-top:8px"><span class="muted small">作答 ${store.attempts[q.id] ? store.attempts[q.id].n : 0} 次，全對 ${store.attempts[q.id] ? store.attempts[q.id].c : 0} 次</span><span class="spacer"></span>
        <button class="btn sm" data-rm="${kind}" data-id="${esc(q.id)}">移出${kind === "wrong" ? "錯題本" : "收藏"}</button></div>
      </details>`).join("")}`).join("");
    app.innerHTML = `
      <h1>錯題本</h1>
      <p class="muted">最近一次沒有全對的題目會自動加入；之後答對就會自動移出。也可以在刷題時按「收藏」。</p>
      <div class="row" style="margin-bottom:14px">
        <button class="btn primary" id="redoWrong" ${wrongIds.length ? "" : "disabled"}>重做錯題（${wrongIds.length}）</button>
        <button class="btn" id="redoStar" ${starIds.length ? "" : "disabled"}>練習收藏題（${starIds.length}）</button>
      </div>
      ${wrongIds.length ? listHtml(wrongIds, "wrong") : `<div class="empty card">目前沒有錯題。</div>`}
      ${starIds.length ? `<h2>收藏題</h2>${listHtml(starIds, "star")}` : ""}`;
    document.getElementById("redoWrong").addEventListener("click", () => startPractice(wrongIds.map((id) => qById[id]), "重做錯題", { shuffle: true }));
    document.getElementById("redoStar").addEventListener("click", () => startPractice(starIds.map((id) => qById[id]), "收藏題", { shuffle: true }));
    app.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      delete store[b.dataset.rm][b.dataset.id];
      save();
      viewReview();
    }));
  }

  // ---------- 學習紀錄 ----------
  function viewStats() {
    const acc = accuracyOf(questions);
    const unitRows = units.map((u) => ({ u, a: accuracyOf(questions.filter((q) => q.unitId === u.id)) })).filter((x) => x.a.total);
    const codeRows = Object.values(codeInfo).map((c) => ({ c, a: accuracyOf(c.questions) })).filter((x) => x.a.done)
      .sort((x, y) => x.a.correct / x.a.done - y.a.correct / y.a.done);
    const lvRows = LEVELS.map((l) => ({ l, a: accuracyOf(questions.filter((q) => q.level === l)) }));
    const hbar = (label, a, href) => `<div class="hbar"><div>${href ? `<a href="${href}">${label}</a>` : label}</div>
      <div class="track" title="已作答 ${a.done}/${a.total}"><div class="fill" style="width:${a.done ? pct(a.correct, a.done) : 0}%"></div></div>
      <div class="val">${a.done ? pct(a.correct, a.done) + "%" : "—"}<span class="small">（${a.done}/${a.total}）</span></div></div>`;
    app.innerHTML = `
      <h1>學習紀錄</h1>
      <div class="stat-row">
        <div class="stat"><div class="num">${acc.done} / ${acc.total}</div><div class="lbl">已作答題數</div></div>
        <div class="stat"><div class="num">${acc.done ? pct(acc.correct, acc.done) + "%" : "—"}</div><div class="lbl">正確率（以最近一次作答計）</div></div>
        <div class="stat"><div class="num">${store.exams.length}</div><div class="lbl">模擬考次數</div></div>
      </div>
      <h2>各單元正確率</h2>
      <div class="card">${unitRows.length ? unitRows.map(({ u, a }) => hbar(esc(u.title), a, `#/kb/${u.id}`)).join("") : `<div class="empty">尚無資料</div>`}
        <p class="small muted">長條長度＝正確率；括號內為已作答／題數。</p></div>
      <h2>各難度正確率</h2>
      <div class="card">${lvRows.map(({ l, a }) => hbar(l, a)).join("")}</div>
      <h2>弱點學習內容</h2>
      <div class="card">${codeRows.length ? `<table class="list"><thead><tr><th>代碼</th><th>內容</th><th>正確率</th><th></th></tr></thead><tbody>${codeRows.slice(0, 12).map(({ c, a }) =>
        `<tr><td><a href="#/code/${encodeURIComponent(c.code)}">${c.code}</a></td><td>${md(c.text)}</td><td>${pct(a.correct, a.done)}%（${a.correct}/${a.done}）</td>
         <td><a class="btn sm" href="#/practice?codes=${encodeURIComponent(c.code)}">練習</a></td></tr>`).join("")}</tbody></table>` : `<div class="empty">作答後會依學習內容代碼找出你的弱點。</div>`}</div>
      ${store.exams.length ? `<h2>模擬考紀錄</h2><div class="card">${examHistoryHtml(30)}</div>` : ""}
      <h2>資料管理</h2>
      <div class="card row">
        <button class="btn" id="exp">匯出紀錄</button>
        <label class="btn">匯入紀錄<input type="file" id="imp" accept="application/json" hidden></label>
        <span class="spacer"></span>
        <button class="btn danger" id="reset">清除所有紀錄</button>
      </div>`;
    document.getElementById("exp").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(store, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `學測化學紀錄_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    document.getElementById("imp").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((t) => {
        try {
          const s = JSON.parse(t);
          store = { attempts: s.attempts || {}, exams: s.exams || [], wrong: s.wrong || {}, star: s.star || {} };
          save();
          viewStats();
        } catch (err) { alert("檔案格式不正確"); }
      });
    });
    document.getElementById("reset").addEventListener("click", () => {
      if (!confirm("確定清除所有作答紀錄、錯題本與考試紀錄？此動作無法復原。")) return;
      store = { attempts: {}, exams: [], wrong: {}, star: {} };
      save();
      viewStats();
    });
  }

  function notFound() {
    app.innerHTML = `<div class="empty card">找不到這個頁面。<a href="#/">回首頁</a></div>`;
  }

  // ---------- 路由 ----------
  function route() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const params = parseQuery(qs);
    clearInterval(timerHandle);
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (parts[0] === "code" ? "kb" : parts[0])));
    document.getElementById("nav").classList.remove("open");
    const keepScroll = parts[0] === "kb" && parts[2];
    switch (parts[0]) {
      case undefined: viewHome(); break;
      case "kb": parts[1] ? viewKbUnit(parts[1], parts[2]) : viewKbIndex(params.q); break;
      case "code": viewCode(parts[1]); break;
      case "practice": parts[1] === "run" ? viewPracticeRun() : viewPracticeSetup(params); break;
      case "exam":
        if (parts[1] === "run") viewExamRun();
        else if (parts[1] && parts[2]) startBankExam(parts[1], parts[2]);
        else viewExamList();
        break;
      case "review": viewReview(); break;
      case "stats": viewStats(); break;
      default: notFound();
    }
    const titles = { kb: "知識庫", code: "學習內容", practice: "刷題練習", exam: "模擬試題", review: "錯題本", stats: "學習紀錄" };
    document.title = (titles[parts[0]] ? titles[parts[0]] + "｜" : "") + "學測化學刷題站";
    if (!keepScroll) window.scrollTo(0, 0);
  }
  document.getElementById("menuBtn").addEventListener("click", (e) => {
    const nav = document.getElementById("nav");
    nav.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", nav.classList.contains("open"));
  });
  window.addEventListener("hashchange", route);
  route();
})();
