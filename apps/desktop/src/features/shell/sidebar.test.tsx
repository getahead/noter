import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../../ui/testing";
import { modeIndicator } from "./mode-indicator";
import { Sidebar, type SidebarProps } from "./sidebar";

const props = (over: Partial<SidebarProps> = {}): SidebarProps => ({
  selected: "today",
  waiting: 0,
  problems: 0,
  writing: false,
  live: null,
  mode: modeIndicator({ mode: "cloud_redacted", degraded: [], sensitiveCall: false }),
  footer: "Idle · API key · local fallback ready",
  overlay: false,
  width: 220,
  onSelect: vi.fn(),
  onShowCall: vi.fn(),
  onToggle: vi.fn(),
  onOpenPrivacy: vi.fn(),
  ...over,
});

describe("Sidebar (cpt-noter-dod-ui-main-window-shell-frame)", () => {
  it("draws MW-R2: eight sections in three groups, the selected one current, the mode footer", () => {
    const html = renderToString(<Sidebar {...props()} />);
    expect(html).toContain('data-region="MW-R2"');
    expect(html).toContain('aria-label="Sidebar"');
    for (const label of ["Today", "Ask", "Library", "Calls", "People", "Topics", "Workspace", "Activity", "Agents", "Performance"]) expect(html).toContain(`>${label}<`);
    expect(html.match(/role="listitem"/g)).toHaveLength(8);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('title="Calls (⌘3)"');
    expect(html).toContain("Idle · API key · local fallback ready");
    expect(html).not.toContain("np-srclist__live");
    expect(html).not.toContain("is-overlay");
  });

  it("shows a progress glyph beside Calls while any call's outputs are being written", () => {
    expect(renderToString(<Sidebar {...props()} />)).not.toContain("np-spin");
    const html = renderToString(<Sidebar {...props({ writing: true })} />);
    expect(html.match(/np-spin/g)).toHaveLength(1);
    expect(html.indexOf("np-spin")).toBeGreaterThan(html.indexOf(">Calls<"));
  });

  it("reads the Activity badge as Activity, 3 waiting, 1 problem", () => {
    const html = renderToString(<Sidebar {...props({ waiting: 3, problems: 1 })} />);
    expect(html).toContain('aria-label="Activity, 3 waiting, 1 problem"');
    expect(html).toContain('<span class="np-srclist__badge" data-variant="badge">3</span>');
    expect(html).toContain("np-srclist__warn");
    expect(renderToString(<Sidebar {...props({ waiting: 1 })} />)).toContain('aria-label="Activity, 1 waiting"');
    expect(renderToString(<Sidebar {...props()} />)).not.toContain("np-srclist__badge");
  });

  it("shows the live-call row while capturing, with Paused instead of the time while paused", () => {
    const live = renderToString(<Sidebar {...props({ live: { title: "Planning", paused: false, seconds: 1394 } })} />);
    expect(live).toContain('data-variant="live-row"');
    expect(live).toContain("Planning");
    expect(live).toContain("00:23:14");
    const paused = renderToString(<Sidebar {...props({ live: { title: "Planning", paused: true, seconds: 1394 } })} />);
    expect(paused).toContain("Paused");
    expect(paused).toContain("np-recdot is-paused");
    expect(paused).not.toContain("00:23:14");
  });

  it("runs the owner's handlers: select a section, show the call, toggle, open privacy", () => {
    const p = props({ live: { title: "Planning", paused: false, seconds: 0 } });
    const tree = rendered(Sidebar, p);
    (find(tree, (x) => x.label === "Calls").props.onSelect as () => void)();
    expect(p.onSelect).toHaveBeenCalledWith("library");
    (find(tree, (x) => x["data-variant"] === "live-row" && typeof x.onClick === "function").props.onClick as () => void)();
    expect(p.onShowCall).toHaveBeenCalledOnce();
    expect(p.onSelect).toHaveBeenCalledOnce(); // the live row shows the call window and leaves the sidebar selection alone
    (find(tree, (x) => x.cls === "np-sidebar__toggle").props.onAction as () => void)();
    expect(p.onToggle).toHaveBeenCalledOnce();
    (find(tree, (x) => typeof x.onOpenPrivacy === "function").props.onOpenPrivacy as () => void)();
    expect(p.onOpenPrivacy).toHaveBeenCalledOnce();
  });

  it("takes its width from the split divider", () => {
    expect(renderToString(<Sidebar {...props({ width: 260 })} />)).toContain('style="width:260px"');
  });

  it("marks the collapsed sidebar opened as an overlay", () => {
    expect(renderToString(<Sidebar {...props({ overlay: true })} />)).toContain("np-sidebar is-overlay");
  });
});
