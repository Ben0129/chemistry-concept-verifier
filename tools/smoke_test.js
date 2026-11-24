// 網站冒煙測試：以 file:// 開啟 index.html，走過每個頁面並模擬作答，有 JS 錯誤即失敗。
// 用法：node tools/smoke_test.js [截圖資料夾]
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html");
const SHOTS = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  const go = async (hash, shot) => {
    await page.goto(URL + hash);
    await page.waitForTimeout(150);
    if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot + ".png"), fullPage: false });
  };
  const data = await (async () => { await page.goto(URL); return page.evaluate(() => window.CHEM_DATA); })();

  await go("#/", "home");
  await go("#/kb", "kb");
  await go("#/kb?q=莫耳");
  for (const u of data.knowledge) await go(`#/kb/${u.id}`, u.id === "u3" ? "kb-unit" : null);
  for (const c of data.curriculum.codes) await go(`#/code/${encodeURIComponent(c.code)}`);

  const nQ = data.questions.reduce((a, f) => a + f.banks.reduce((b, k) => b + k.questions.length, 0), 0);
  if (nQ) {
    // 刷題：作答 5 題
    await go("#/practice", "practice-setup");
    await page.click("#pf button[type=submit]");
    for (let i = 0; i < 5; i++) {
      await page.click(".opt >> nth=0");
      await page.click("#submit");
      if (i === 0 && SHOTS) await page.screenshot({ path: path.join(SHOTS, "practice-answer.png") });
      await page.click("#next");
    }
    // 每份單元試卷：作答後交卷
    for (const f of data.questions) {
      for (const b of f.banks) {
        await go(`#/exam/${f.unit_id}/${encodeURIComponent(b.key)}`);
        await page.waitForSelector("#submitExam");
        const opts = await page.$$(".opts");
        for (const o of opts) await (await o.$(".opt")).click();
        await page.click("#submitExam");
        await page.waitForSelector(".score-big");
      }
    }
    await go("#/exam", "exam-list");
    await page.click("#mixf button[type=submit]");
    await page.waitForSelector("#submitExam");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-mix.png") });
    await page.click("#submitExam");
    await page.waitForSelector(".score-big");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-result.png") });
    await go("#/review", "review");
    await go("#/stats", "stats");
  }
  // 手機寬度
  await page.setViewportSize({ width: 390, height: 844 });
  await go("#/kb/u4", "mobile-kb");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push("手機寬度出現水平捲動");

  await browser.close();
  if (errors.length) {
    console.error("失敗：\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log(`通過：知識庫 ${data.knowledge.length} 單元、${data.curriculum.codes.length} 個代碼頁、${nQ} 題選擇題`);
})();
