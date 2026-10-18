// The primitives page of cpt-noter-feature-ui-primitives: every primitive of this lane in every static
// state of DESIGN's inventory table and the prototype, rendered by the app over the fake core through
// the bridge. Pointer and keyboard states (hover, pressed, focus) are CSS; the screenshot spec drives
// them on the cells named by data-cell. Served by the Vite dev server at /tests/visual/pages/primitives.html.
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { createBridge } from "../../../src/app/bridge/bridge";
import { FakeCore } from "../../../src/core/fake/fake-core";
import { Badge } from "../../../src/ui/primitives/badge";
import { Checkbox } from "../../../src/ui/primitives/checkbox";
import { Disclosure } from "../../../src/ui/primitives/disclosure";
import { IconButton } from "../../../src/ui/primitives/icon-button";
import { KeyCap } from "../../../src/ui/primitives/key-cap";
import { LevelMeter } from "../../../src/ui/primitives/level-meter";
import { Link } from "../../../src/ui/primitives/link";
import { PopupButton } from "../../../src/ui/primitives/popup-button";
import { Progress } from "../../../src/ui/primitives/progress";
import { PullDownButton } from "../../../src/ui/primitives/pull-down-button";
import { PushButton } from "../../../src/ui/primitives/push-button";
import { RadioGroup } from "../../../src/ui/primitives/radio-group";
import { SearchField } from "../../../src/ui/primitives/search-field";
import { SegmentedControl } from "../../../src/ui/primitives/segmented-control";
import { Slider } from "../../../src/ui/primitives/slider";
import { TextField } from "../../../src/ui/primitives/text-field";
import { Toggle } from "../../../src/ui/primitives/toggle";

const bridge = createBridge("main", new FakeCore({ window: "main" }));

const page = `
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--win-bg); color: var(--label); font: 400 13px/18px var(--font); }
  .pg { padding: 24px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; width: 1200px; }
  .pg section { background: var(--content-bg); border: 1px solid var(--sep); border-radius: var(--r-card); padding: 12px; }
  .pg h2 { margin: 0 0 8px; font: 600 11px/14px var(--font); color: var(--label-2); }
  .pg .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 8px; }
  .pg .glass { padding: 8px; border-radius: var(--r-card); background: linear-gradient(90deg, var(--accent), var(--success)); }
  .pg .narrow { width: 140px; }
`;

const Section = ({ name, children }: { name: string; children: ReactNode }) => (
  <section data-gallery={name}>
    <h2>{name}</h2>
    {children}
  </section>
);
const Row = ({ children }: { children: ReactNode }) => <div className="row">{children}</div>;

const views = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month", disabled: true },
];
const options = ["English", "Deutsch", { value: "ja", label: "日本語", disabled: true }];

function Gallery() {
  return (
    <div className="pg" data-region="window" data-window={bridge.label}>
      <style>{page}</style>
      <Section name="push-button">
        {(["primary", "secondary", "quiet", "destructive"] as const).map((variant) => (
          <Row key={variant}>
            {(["small", "regular", "large"] as const).map((size) => (
              <PushButton key={size} id={`btn-${variant}-${size}`} label={variant === "destructive" ? "Delete Call" : "Record"} variant={variant} size={size} />
            ))}
            <PushButton label="Record" variant={variant} icon="record" kbd="⌘R" />
            <PushButton label="Retry" variant={variant} icon="refresh" loading />
            <PushButton label="Record" variant={variant} disabled help="Free up 500 MB to record" />
          </Row>
        ))}
        <Row>
          <PushButton id="btn-hover" label="Hover" />
          <PushButton id="btn-pressed" label="Pressed" />
          <PushButton id="btn-focus" label="Focus" />
          <PushButton label="Copy" flash="Copied" />
          <PushButton label="Share…" chevron />
        </Row>
      </Section>

      <Section name="icon-button">
        <Row>
          <span className="glass">
            <IconButton id="ibtn-toolbar" icon="sidebar" label="Show Sidebar" />
            <IconButton icon="bell" label="Notifications" badge="3" />
            <IconButton icon="pin" label="Pin" on pressed />
            <IconButton icon="trash" label="Delete" disabled help="Nothing selected" />
          </span>
          <IconButton id="ibtn-inline" icon="copy" label="Copy" size="inline" />
          <IconButton icon="ellipsis" label="More" size="inline" disabled />
        </Row>
      </Section>

      <Section name="segmented-control">
        <Row>
          <SegmentedControl id="seg-view" items={views} value="day" label="View" />
          <SegmentedControl items={["Light", "Dark", "Auto"]} value="Auto" variant="option" label="Appearance" />
          <SegmentedControl items={[{ value: "open", label: "Open", count: 4 }, { value: "done", label: "Done", count: 12, icon: "check" }]} value="done" label="Items" />
        </Row>
        <div className="row narrow" data-cell="seg-fallback">
          <SegmentedControl items={["Transcript", "Summary", "Action Items"]} value="Summary" label="Show" />
        </div>
      </Section>

      <Section name="popup-button">
        <Row>
          <PopupButton id="popup-form" options={options} value="English" label="Language" />
          <span className="glass">
            <PopupButton options={["All Calls", "Starred"]} value="Starred" variant="toolbar" label="Filter" />
          </span>
          <PopupButton options={["Anna +1", "Anna"]} value="Anna +1" variant="inline" state="mixed" label="Speaker" />
          <PopupButton options={options} value="Deutsch" disabled label="Language" />
        </Row>
      </Section>

      <Section name="pull-down-button">
        <Row>
          <PullDownButton id="pd-share" label="Share" icon="export" />
          <PullDownButton label="Add Agent" open />
          <PullDownButton label="Not Now" variant="panel" size="small" />
          <PullDownButton label="Mute" disabled />
          <PullDownButton label="More" iconOnly />
          <PullDownButton label="More" iconOnly open />
        </Row>
      </Section>

      <Section name="checkbox">
        <Row>
          <Checkbox id="check-off" label="Off" checked={false} />
          <Checkbox label="On" checked />
          <Checkbox label="Mixed" checked={false} mixed variant="mixed" />
          <Checkbox label="Disabled" checked={false} disabled />
          <Checkbox label="Disabled on" checked disabled />
          <Checkbox ariaLabel="Select row" checked variant="group" />
        </Row>
      </Section>

      <Section name="toggle">
        <Row>
          <Toggle id="toggle-off" label="Off" on={false} />
          <Toggle label="On" on />
          <Toggle label="Small" on size="small" labelAfter />
          <Toggle label="Disabled" on={false} disabled />
          <Toggle label="Disabled on" on disabled />
        </Row>
      </Section>

      <Section name="radio-group">
        <RadioGroup
          name="retention"
          label="Keep recordings"
          value="30"
          options={[
            { value: "forever", label: "Forever" },
            { value: "30", label: "30 days", note: "Older audio is deleted; transcripts stay." },
            { value: "never", label: "Do not keep audio", disabled: true },
          ]}
        />
      </Section>

      <Section name="text-field">
        <Row>
          <TextField id="field-default" label="Title" placeholder="Untitled call" />
          <TextField label="Title" value="Sprint 42 retro" readonly />
          <TextField label="Title" value="Sprint 42 retro" disabled />
          <TextField label="API key" value="sk-secret" variant="secure" />
        </Row>
        <Row>
          <TextField label="Port" value="65536" invalid message="Use a port from 1 to 65535." />
          <TextField label="Minutes" value="30" variant="number" min={1} max={120} />
          <TextField label="Date" value="2026-10-18" variant="date" />
        </Row>
        <Row>
          <TextField label="Notes" showLabel variant="multi" value={"Line one\nLine two"} mono />
        </Row>
      </Section>

      <Section name="search-field">
        <Row>
          <SearchField id="search-empty" placeholder="Search" />
          <SearchField placeholder="Search" value="budget" />
          <SearchField placeholder="Search" tokens={[{ label: "Anna", kind: "person" }, { label: "Tag: release" }]} />
          <SearchField placeholder="Search" value="q3" state="searching" />
          <SearchField variant="token-field" placeholder="Add tag…" tokens={[{ label: "release", kind: "tag" }]} />
        </Row>
      </Section>

      <Section name="slider">
        <Row>
          <Slider id="slider-default" value={18} label="Silence threshold" unit="%" valueText="18 percent" />
          <Slider value={60} label="Volume" disabled />
        </Row>
      </Section>

      <Section name="progress">
        <Row>
          <Progress value={64} label="Transcribing" />
          <Progress label="Preparing" />
          <Progress value={40} state="paused" label="Paused" />
          <Progress value={100} state="finished" label="Done" />
          <Progress value={30} state="failed" label="Failed" />
          <Progress variant="spinner" />
        </Row>
      </Section>

      <Section name="level-meter">
        <Row>
          <LevelMeter label="Microphone level" />
          <LevelMeter level={6} label="Microphone level" />
          <LevelMeter level={10} clipping label="Microphone level" />
        </Row>
      </Section>

      <Section name="badge">
        <Row>
          <Badge text="12" kind="count" />
          <Badge text="Zoom" kind="kind" />
          {(["neutral", "info", "warning", "error", "success", "accent"] as const).map((tone) => (
            <Badge key={tone} text={tone[0].toUpperCase() + tone.slice(1)} tone={tone} />
          ))}
          <Badge text="Offline" tone="warning" icon="warning" />
        </Row>
      </Section>

      <Section name="disclosure">
        <Row>
          <Disclosure id="disc-section" label="Action items" open={false} />
          <Disclosure label="Action items" open />
          <Disclosure label="Details" open={false} variant="row" />
          <Disclosure label="Details" open variant="row" />
        </Row>
      </Section>

      <Section name="link">
        <Row>
          <Link id="link-inline" label="Privacy settings" />
          <Link label="Open in Calendar" external ariaLabel="Open in Calendar, opens in Calendar" />
        </Row>
      </Section>

      <Section name="key-cap">
        <Row>
          <KeyCap keys="⌘" />
          <KeyCap keys="⌃⌥⌘R" />
          <KeyCap keys="⇧⌘F" />
        </Row>
      </Section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
void bridge.open();
