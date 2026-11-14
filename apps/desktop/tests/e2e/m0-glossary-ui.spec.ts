// M0 — Settings › Audio & Transcription › Glossary (docs/features/ui/settings.md, flow change-setting, case glossary):
// the page adds a term with `glossary_upsert` and removes it with `glossary_remove`; the core's list is what the table shows.
import type { Page } from "@playwright/test";

import { calls, openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const panes = (page: Page) => page.getByRole("navigation", { name: "Settings panes" });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');

test.describe("cpt-noter-flow-ui-settings-change-setting (glossary)", () => {
  test("UI — other path: the Glossary table is one Tab stop (the selected term, else the first)", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByRole("listitem").filter({ hasText: "Audio & Transcription" }).click();
    await expect.poll(() => sent(page, "glossary_list")).not.toEqual([]);
    const rows = pane(page).getByRole("table", { name: "Glossary" }).locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(pane(page).locator('table[aria-label="Glossary"] tbody tr[tabindex="0"]')).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("tabindex", "0");
  });

  test("UI — happy path: + adds a term with glossary_upsert, it is listed; − removes the selected one with glossary_remove", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByRole("listitem").filter({ hasText: "Audio & Transcription" }).click();
    await expect.poll(() => sent(page, "glossary_list")).not.toEqual([]);
    const glossary = pane(page).getByRole("table", { name: "Glossary" });

    await pane(page).getByRole("button", { name: "Add Term" }).click();
    await page.getByRole("textbox", { name: "Term" }).fill("Kubernetes");
    await page.getByRole("textbox", { name: "Spoken forms" }).fill("kubernetis, koo-ber-net-ees");
    await pane(page).getByRole("button", { name: "Add", exact: true }).click();
    const row = glossary.getByRole("row").filter({ hasText: "Kubernetes" });
    await expect(row).toBeVisible();
    expect(await sent(page, "glossary_upsert")).toContainEqual(expect.objectContaining({ term: "Kubernetes", spoken_forms: ["kubernetis", "koo-ber-net-ees"] }));

    await row.focus();
    await row.press("Enter");
    await page.getByRole("textbox", { name: "Term" }).fill("Kubernetes Platform");
    await pane(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(glossary.getByRole("row").filter({ hasText: "Kubernetes Platform" })).toBeVisible();
    expect(await sent(page, "glossary_upsert")).toHaveLength(2);
    expect((await sent(page, "glossary_upsert"))[1]).toMatchObject({ id: expect.any(String), rev: expect.any(Number), term: "Kubernetes Platform" });

    await glossary.getByRole("row").filter({ hasText: "Kubernetes Platform" }).click();
    await pane(page).getByRole("button", { name: "Remove Term" }).click();
    await expect(glossary.getByRole("row").filter({ hasText: "Kubernetes Platform" })).toHaveCount(0);
    expect(await sent(page, "glossary_remove")).toHaveLength(1);
  });
});
