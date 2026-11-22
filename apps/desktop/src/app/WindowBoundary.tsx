// The window's root error boundary: one failed render or effect keeps the window, shows the window-error
// banner the store's errors use (MB-2) with Try Again, and sends the error through log_ui (release builds have no
// Web Inspector, so this line is the only trace).
import { Component, type ReactNode } from "react";

import { t } from "../i18n/format";
import { InlineBanner } from "../ui/feedback/inline-banner";
import type { Bridge } from "./bridge/bridge";

interface Props { bridge: Bridge; children: ReactNode }
interface State { failed: boolean }

// @cpt-component:cpt-noter-component-app-window-store:p1
export class WindowBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // the error's name and message, never the page's content
    void this.props.bridge.core.logUi({ level: "error", screen: this.props.bridge.label, code: null, message: `${error.name}: ${error.message}` });
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div data-region="window" data-window={this.props.bridge.label} data-state="error">
        <section data-region="section-error">
          <InlineBanner banner={{ id: "window-error", severity: "error", text: t("window.error"), actions: [{ label: t("action.try_again"), onAction: this.retry }] }} />
        </section>
      </div>
    );
  }
}
