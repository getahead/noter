// M0 — Accessibility and localisation on the screens that exist (docs/features/ui/accessibility-l10n.md ›
// Acceptance criteria; main-window-shell.md: no truncation in the pseudo-localised build).
// The three M0 screens are the main window, the first-run window and the Settings window: each is
// run keyboard-only (Tab from the page start, every stop has an accessible name, no trap) and in the
// Cyrillic (+40 %) and German (+30 %) pseudo-localised build, failing on any truncated label.
import type { Page } from "@playwright/test";

import { setPseudo, t, type Pseudo } from "../../src/i18n/format";
import { openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const SCREENS = ["main", "first-run", "settings"] as const;
const frame = (page: Page) => page.locator('[data-region="window"]');

const TRUNCATABLE =
  'button, [role="menuitem"], [role="tab"], [role="option"], [role="listitem"], [role="heading"], h1, h2, h3, label, [data-region="MW-R2"] *';

/** Labels clipped across (ellipsis) or down (line clamp, fixed height); containers that only scroll are not labels. */
const truncatedLabels = (page: Page) =>
  page.$$eval(TRUNCATABLE, (els) =>
    els
      .filter((el) => {
        const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
        const leaf = own || el.matches("button, [role='menuitem'], [role='tab']");
        const clipsDown = getComputedStyle(el).overflowY !== "visible"; // a line box a pixel taller than its button is not a clipped label
        return leaf && (el.scrollWidth > el.clientWidth + 1 || (clipsDown && el.scrollHeight > el.clientHeight + 1));
      })
      .map((el) => (el.textContent ?? "").trim() || el.getAttribute("aria-label") || el.tagName),
  );

const pseudo = (mode: Pseudo, key: Parameters<typeof t>[0]) => {
  setPseudo(mode);
  const text = t(key);
  setPseudo("off");
  return text;
};

/** The accessible name a screen reader would speak for the focused element. */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const byId = (ids: string | null) => (ids ?? "").split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? "").join(" ").trim();
    const labelled = (el as HTMLInputElement).labels ? [...(el as HTMLInputElement).labels!].map((l) => l.textContent ?? "").join(" ").trim() : "";
    const name =
      el.getAttribute("aria-label")?.trim() ||
      byId(el.getAttribute("aria-labelledby")) ||
      labelled ||
      (el.textContent ?? "").trim() ||
      el.getAttribute("title")?.trim() ||
      el.getAttribute("placeholder")?.trim() ||
      "";
    return { tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), name, key: `${el.tagName}|${el.id}|${el.className}|${name}` };
  });

test.describe("cpt-noter-flow-ui-accessibility-l10n-keyboard", () => {
  for (const label of SCREENS) {
    test(`UI — ${label}: Tab walks every stop with an accessible name and comes back round, no trap`, async ({ page }) => {
      await openWindow(page, label);
      await expect(frame(page)).toHaveAttribute("data-state", /ready|capturing|pane|step/);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const seen: string[] = [];
      for (let i = 0; i < 120; i++) {
        await page.keyboard.press("Tab");
        const f = await focusedName(page);
        if (!f) continue; // focus left the page content (browser chrome): the next Tab comes back
        expect(f.name, `an unnamed ${f.tag}${f.role ? `[role=${f.role}]` : ""} took a Tab stop on ${label}`).not.toBe("");
        if (seen.includes(f.key)) break; // round again: focus is not trapped
        seen.push(f.key);
      }
      expect(seen.length, `${label} has Tab stops`).toBeGreaterThan(1);
      expect(seen.length, `${label}: Tab never came back to its first stop within 120 presses`).toBeLessThan(120);
    });
  }
});

test.describe("cpt-noter-flow-ui-accessibility-l10n-pseudo", () => {
  for (const mode of ["cyrillic", "german"] as const) {
    test(`UI — main window in ${mode} pseudo-localisation: no truncated sidebar label, group header or toolbar button`, async ({ page }) => {
      await openWindow(page, `main&pseudo=${mode}`);
      await expect(frame(page)).toHaveAttribute("data-state", /ready|capturing/);
      await expect(page.locator('[data-region="MW-R2"]')).toBeVisible();
      const truncated = await truncatedLabels(page);
      expect(truncated, `truncated: ${truncated.join(", ")}`).toEqual([]);
    });

    test(`UI — first-run window in ${mode} pseudo-localisation: no truncated label on any step`, async ({ page }) => {
      await openWindow(page, `first-run&pseudo=${mode}`);
      await expect(frame(page)).toHaveAttribute("data-state", /ready|step/);
      // the wizard opens on the step the world's setup has reached; Back walks to Welcome
      const back = page.getByRole("button", { name: pseudo(mode, "first_run.back"), exact: true });
      await expect(back).toBeVisible();
      let visited = 0;
      do {
        visited++;
        const truncated = await truncatedLabels(page);
        expect(truncated, `step ${visited} truncated: ${truncated.join(", ")}`).toEqual([]);
        if (await back.isDisabled()) break;
        await back.click();
      } while (visited < 6);
      expect(visited, "the pass walked past the first step").toBeGreaterThan(1);
    });

    test(`UI — Settings window in ${mode} pseudo-localisation: no truncated label in any pane`, async ({ page }) => {
      await openWindow(page, `settings&pseudo=${mode}`);
      const panes = page.locator('[data-region="ST-R1"] [role="list"] > [role="listitem"]');
      await expect(panes.first()).toBeVisible();
      const count = await panes.count();
      expect(count).toBe(11);
      for (let i = 0; i < count; i++) {
        await panes.nth(i).click();
        const truncated = await truncatedLabels(page);
        expect(truncated, `pane ${i + 1} truncated: ${truncated.join(", ")}`).toEqual([]);
      }
    });
  }
  test("the truncation check fails on a deliberately long label", async ({ page }) => {
    await page.setContent(`<button style="width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">Keep Recording Anyway</button><button>Fits</button>`);
    expect(await truncatedLabels(page)).toEqual(["Keep Recording Anyway"]);
  });
});

test.describe("cpt-noter-flow-ui-accessibility-l10n-lang", () => {
  test("UI — the document is English and every Cyrillic content cell of the glossary carries its own lang", async ({ page }) => {
    await openWindow(page, "settings");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("navigation", { name: t("settings.panes") }).getByRole("listitem").filter({ hasText: t("settings.pane.audio_and_transcription") }).click();
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    const cyrillic = rows.locator("td:nth-child(3)");
    expect(await cyrillic.count()).toBeGreaterThan(0);
    for (const cell of await cyrillic.all()) await expect(cell).toHaveAttribute("lang", "ru");
  });
});
