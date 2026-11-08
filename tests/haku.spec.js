// Haku pages: one native fact row inside matching result cards — no boxes,
// no detail panel, no guessing on cards without a confident match.
import { test, expect } from "@playwright/test";
import { gotoKonfo, collectErrors, URLS } from "./helpers.js";

test("haku cards get native fact rows, nothing else", async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKonfo(page, URLS.haku);

  const res = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("main .EntiteettiKortti-paperRoot")];
    const injected = cards.filter((c) => c.querySelector("[data-sijoittumis]"));
    const row = injected[0]?.querySelector("[data-sijoittumis] p");
    const cs = row ? getComputedStyle(row) : null;
    return {
      cards: cards.length,
      injected: injected.length,
      text: row?.textContent?.slice(0, 100) || null,
      tooltip: row?.getAttribute("title")?.slice(0, 140) || null,
      font: cs ? `${cs.fontSize}/${cs.fontWeight}` : null,
      color: cs?.color || null,
      bg: row
        ? getComputedStyle(row.closest("[data-sijoittumis]")).backgroundColor
        : null,
      inIconBox: !!injected[0]
        ?.querySelector("[data-sijoittumis]")
        ?.closest(".EntiteettiKortti-iconTexts"),
      detailPanel: !!document.getElementById("sijoittumisdata-panel"),
    };
  });

  expect(res.cards).toBeGreaterThan(0);
  expect(res.injected).toBeGreaterThan(0);
  expect(res.injected).toBeLessThanOrEqual(res.cards);
  expect(res.text).toMatch(/Työttömyysaste .+ % · Mediaanitulo .+ €/);
  expect(res.tooltip).toMatch(/Lähde: Tilastokeskus/);
  expect(res.font).toBe("16px/400");
  expect(res.color).toBe("rgb(29, 29, 29)");
  expect(res.bg).toBe("rgba(0, 0, 0, 0)"); // transparent — integrated, not a box
  expect(res.inIconBox).toBe(true);
  expect(res.detailPanel).toBe(false);
  expect(errors).toEqual([]);
});
