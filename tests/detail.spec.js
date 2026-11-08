// Detail pages: the section renders inline before "Koulutuksen perustiedot",
// styled like a native Konfo info block, with no page errors.
import { test, expect } from "@playwright/test";
import { gotoKonfo, collectErrors, URLS } from "./helpers.js";

const PAGES = [
  {
    name: "toteutus",
    url: URLS.toteutus,
    degree: "Tietojenkäsittelytiede (fil. maist.)",
  },
  { name: "koulutus", url: URLS.koulutus, degree: "Arkkitehti" },
];

for (const { name, url, degree } of PAGES) {
  test(`${name} renders a native inline section`, async ({ page }) => {
    const errors = collectErrors(page);
    await gotoKonfo(page, url);

    const panel = await page.evaluate(() => {
      const host = document.getElementById("sijoittumisdata-panel");
      if (!host) return null;
      const h2 = [...document.querySelectorAll("main h2")].find((h) =>
        /^koulutuksen perustiedot/i.test((h.textContent || "").trim()),
      );
      const sh = host.shadowRoot;
      const paper = sh.querySelector(".paper");
      // nearest Konfo paper: same anchor rule as findPaperStyle in content.js
      // (the paper inside the perustiedot section, field-tinted on some pages)
      const main = document.querySelector("main");
      let section = h2?.parentElement || null;
      while (
        section &&
        section.parentElement &&
        section.parentElement !== main &&
        section.parentElement.children.length < 3
      ) {
        section = section.parentElement;
      }
      const ref = section?.querySelector(".MuiPaper-root") || null;
      return {
        inMain: !!host.closest("main"),
        beforePerustiedot: h2
          ? !!(host.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING)
          : null,
        rows: [...sh.querySelectorAll(".prow")].map((r) => ({
          label: r.querySelector(".plabel")?.textContent,
          value: r.querySelector(".pvalue")?.textContent,
        })),
        sub: sh.querySelector(".psub")?.textContent,
        foot: sh.querySelector(".foot")?.textContent?.replace(/\s+/g, " ").trim(),
        labelFont: getComputedStyle(sh.querySelector(".plabel")).fontFamily,
        paperBg: getComputedStyle(paper).backgroundColor,
        paperRadius: getComputedStyle(paper).borderRadius,
        refBg: ref ? getComputedStyle(ref).backgroundColor : null,
        buttons: sh.querySelectorAll("button").length,
      };
    });

    expect(panel, "panel injected into the page").not.toBeNull();
    expect(panel.inMain).toBe(true);
    expect(panel.beforePerustiedot).toBe(true);
    expect(panel.rows.map((r) => r.label)).toEqual([
      "Tutkinto",
      "Työttömyysaste",
      "Mediaanitulo",
    ]);
    expect(panel.rows[0].value).toBe(degree);
    expect(panel.rows[1].value).toMatch(/\d+[.,]\d\s*%/);
    expect(panel.rows[2].value).toMatch(/€/);
    expect(panel.sub).toMatch(/valmistuneita$/);
    expect(panel.foot).toMatch(/Lähde: Tilastokeskus/);
    expect(panel.labelFont).toMatch(/Open Sans/);
    expect(panel.paperRadius).toBe("4px");
    if (panel.refBg) expect(panel.paperBg).toBe(panel.refBg);
    expect(panel.buttons).toBe(0);
    expect(errors).toEqual([]);
  });
}
