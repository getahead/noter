import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "./en";
import { callTime, duration, formatDateTime, quote, setPseudo, t, tParts, usd } from "./format";
import { Msg } from "./Msg";

afterEach(() => setPseudo("off"));

describe("t", () => {
  it("fills placeholders, formats numbers by locale and picks the plural", () => {
    expect(t("announce.recording_stopped", { duration: "48 min" })).toBe("Recording stopped, saved 48 min");
    expect(t("announce.cards_held", { count: 1 })).toBe("1 new card waiting");
    expect(t("announce.cards_held", { count: 1200 })).toBe("1,200 new cards waiting");
    expect(t("announce.search_done", { count: 0 })).toBe("0 results");
  });
  it("leaves a missing placeholder visible and plain messages untouched", () => {
    expect(t("announce.copied")).toBe("Copied for {target}");
    expect(t("action.try_again")).toBe("Try Again");
  });
  it("falls back to en without a navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(t("announce.cards_held", { count: 2 })).toBe("2 new cards waiting");
    vi.unstubAllGlobals();
  });
});

describe("tParts and quote", () => {
  it("gives quoted user text its own lang and keeps the rest plain", () => {
    expect(tParts("announce.copied", { target: quote("Привет", "ru") })).toEqual([
      { text: "Copied for " },
      { text: "“Привет”", lang: "ru" },
    ]);
  });
  it("renders through <Msg>", () => {
    expect(renderToStaticMarkup(<Msg id="announce.copied" args={{ target: quote("Hallo", "de") }} />)).toBe('Copied for <span lang="de">“Hallo”</span>');
    expect(renderToStaticMarkup(<Msg id="window.error" />)).toBe("Something went wrong");
  });
});

describe("pseudo-localisation", () => {
  it("maps to Cyrillic look-alikes, pads +40 % and keeps placeholders and args", () => {
    setPseudo("cyrillic");
    const s = t("announce.copied", { target: "Apex" });
    expect(s).toContain("Apex");
    expect(s).not.toContain("Copied");
    expect(s.startsWith("Сорiеd")).toBe(true);
    expect(t("announce.copied", { target: "" }).length).toBeGreaterThanOrEqual(Math.ceil("Copied for ".length * 1.4));
  });
  it("uses umlauts for German and +40 % only for short labels", () => {
    setPseudo("german");
    expect(t("action.try_again").length).toBe("Try Again".length + 4);
    expect(t("window.error").length).toBe("Something went wrong".length + 6);
    expect(t("window.error")).toContain("ö");
  });
  it("switches off again", () => {
    setPseudo("german");
    setPseudo("off");
    expect(t("action.try_again")).toBe("Try Again");
  });
});

describe("value helpers", () => {
  it("callTime is always HH:MM:SS", () => {
    expect(callTime(0)).toBe("00:00:00");
    expect(callTime(3725.9)).toBe("01:02:05");
    expect(callTime(-5)).toBe("00:00:00");
    expect(callTime(Number.NaN)).toBe("00:00:00");
  });
  it("duration is a short localised duration", () => {
    expect(duration(2880)).toBe("48 min");
    expect(duration(0)).toBe("0 sec");
    expect(duration(3660)).toBe("1 hr, 1 min");
  });
  it("usd is money in the locale format", () => {
    expect(usd(0.31)).toBe("$0.31");
  });
  it("formatDateTime follows the 12/24 hour preference and the time zone", () => {
    const ms = Date.UTC(2026, 9, 18, 15, 30);
    expect(formatDateTime(ms, { time_format: "h12", first_weekday: 1, time_zone: "UTC" })).toMatch(/3:30\sPM/);
    expect(formatDateTime(ms, { time_format: "h24", first_weekday: 1, time_zone: "UTC" })).toContain("15:30");
    // a zone the core sent that this WebView does not know falls back to the system zone instead of throwing
    expect(formatDateTime(ms, { time_format: "h24", first_weekday: 1, time_zone: "Not/AZone" })).toMatch(/\d\d:30/);
    expect(formatDateTime(ms, { time_format: "h24", first_weekday: 1, time_zone: "" })).toMatch(/\d\d:30/);
  });
  it("the catalogue has an entry for each v1 string", () => {
    expect(Object.keys(en)).toHaveLength(83);
  });
});
