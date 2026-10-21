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

/** Every control a user can reach by Tab: natively focusable or tabindex >= 0, enabled, drawn. Each gets a marker to be told apart. */
const markTabbable = (page: Page) =>
  page.evaluate(() => {
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [tabindex]';
    const els = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      // a radio group is one Tab stop (the checked radio, or the first); arrows move inside it
      const radios = el instanceof HTMLInputElement && el.type === "radio" ? [...document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${el.name}"]`)] : null;
      if (radios && el.name && radios.some((o) => o.checked) ? !el.checked : radios && el.name && radios[0] !== el) return false;
      return el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("fieldset:disabled, [inert], [hidden]") && st.visibility !== "hidden" && st.display !== "none" && r.width > 0 && r.height > 0;
    });
    // idempotent: controls that became enabled since (a selection enables Remove) are marked on the next call
    let next = document.querySelectorAll("[data-kbd]").length;
    els.filter((el) => !el.hasAttribute("data-kbd")).forEach((el) => el.setAttribute("data-kbd", String(next++)));
    return next;
  });
const focusedMark = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-kbd") ?? null);

/** Walk Tab (or Shift+Tab) from the page start until the walk repeats or leaves the controls; return the markers reached, in order. */
async function walk(page: Page, key: "Tab" | "Shift+Tab", limit: number): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached: string[] = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(key);
    await markTabbable(page);
    const mark = await focusedMark(page);
    if (mark === null) break; // focus left the controls: not trapped
    if (reached.includes(mark)) break; // came round: not trapped
    reached.push(mark);
  }
  return reached;
}

/** The controls (by identity) that `key` never lands on in a walk from the page start; Tab-reachable ones are all of them, or the screen traps focus. */
async function unreachable(page: Page, key: "Tab" | "Shift+Tab"): Promise<{ missed: string[]; reached: number; total: number }> {
  await page.evaluate(() => document.querySelectorAll("[data-kbd]").forEach((e) => e.removeAttribute("data-kbd")));
  let total = await markTabbable(page);
  const reached = await walk(page, key, total + 5);
  total = await markTabbable(page); // a control a stop enabled (selecting a row enables Remove) counts too
  const missed = await page.$$eval("[data-kbd]", (els, got) => els.filter((e) => !got.includes(e.getAttribute("data-kbd")!)).map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[${e.getAttribute("role")}]` : ""} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40)}"`), reached);
  return { missed, reached: reached.length, total };
}

/** Tab and Shift+Tab reach every control of the screen as it is now, each named, and the walk ends. */
async function assertReachable(page: Page, where: string): Promise<void> {
  let total = 0;
  for (const key of ["Tab", "Shift+Tab"] as const) {
    const r = await unreachable(page, key);
    total = r.total;
    expect(r.missed, `${key} on ${where} did not reach (${r.reached} of ${r.total} reached)`).toEqual([]);
  }
  expect(total, `${where} has controls`).toBeGreaterThan(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < total; i++) {
    await page.keyboard.press("Tab");
    const f = await focusedName(page);
    if (!f) break;
    expect(f.name, `an unnamed ${f.tag}${f.role ? `[role=${f.role}]` : ""} took a Tab stop on ${where}`).not.toBe("");
  }
}

test.describe("cpt-noter-flow-ui-accessibility-l10n-keyboard", () => {
  for (const label of SCREENS) {
    test(`UI — ${label}: Tab and Shift+Tab reach every control, each with an accessible name, and the walk ends (no trap)`, async ({ page }) => {
      await openWindow(page, label);
      await expect(frame(page)).toHaveAttribute("data-state", /ready|capturing|pane|step/);
      await assertReachable(page, label);
      if (label === "first-run") {
        // every step of the wizard, the opening one first, then Back to Welcome and Continue to the end
        const back = page.getByRole("button", { name: "Back", exact: true });
        const next = page.getByRole("button", { name: "Continue", exact: true });
        for (let i = 0; i < 6 && !(await back.isDisabled()); i++) {
          await back.click();
          await assertReachable(page, `first-run back ${i + 1}`);
        }
        for (let i = 0; i < 6 && (await next.count()) && !(await next.isDisabled()); i++) {
          await next.click();
          await assertReachable(page, `first-run forward ${i + 1}`);
        }
      }
      if (label === "settings") {
        const panes = page.locator('[data-region="ST-R1"] [role="list"] > [role="listitem"]');
        for (let i = 0; i < (await panes.count()); i++) {
          await panes.nth(i).click();
          await assertReachable(page, `settings pane ${i + 1}`);
        }
      }
    });
  }
});

test("the reachability check fails on a two-control trap with an unreachable third action", async ({ page }) => {
  await page.setContent(`<button id="a">A</button><button id="b">B</button><button id="c">C</button>
    <script>
      // Tab cycles only A and B, as a broken focus manager would
      addEventListener("keydown", (e) => {
        if (e.key !== "Tab") return;
        e.preventDefault();
        document.getElementById(document.activeElement.id === "a" ? "b" : "a").focus();
      });
    </script>`);
  const r = await unreachable(page, "Tab");
  expect(r.missed).toEqual(['button "C"']);
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
      // the wizard opens on the step the core's setup has reached (the fake: the last, the real core: the first):
      // Back walks to Welcome, Continue then walks every step to Finish
      const back = page.getByRole("button", { name: pseudo(mode, "first_run.back"), exact: true });
      const next = page.getByRole("button", { name: pseudo(mode, "first_run.continue"), exact: true });
      await expect(back).toBeVisible();
      let visited = 0;
      const check = async () => {
        visited++;
        const truncated = await truncatedLabels(page);
        expect(truncated, `step view ${visited} truncated: ${truncated.join(", ")}`).toEqual([]);
      };
      await check();
      for (let i = 0; i < 6 && !(await back.isDisabled()); i++) {
        await back.click();
        await check();
      }
      for (let i = 0; i < 6 && (await next.count()) && !(await next.isDisabled()); i++) {
        await next.click();
        await check();
      }
      expect(visited, "the pass walked more than one step").toBeGreaterThan(1);
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
  test("UI — Settings: the document is English and every Cyrillic content cell of the glossary carries its own lang", async ({ page }) => {
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
