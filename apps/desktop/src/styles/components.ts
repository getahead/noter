// The component stylesheets of the primitives and shared components, after the token sheet they read
// (docs/features/ui/primitives.md). Ported as-is from the prototype's 00-base.css and 01-macos27.css;
// importing a primitive loads them, so no screen imports the .css files itself.
import "./tokens";
// The pointer and keyboard feedback of every control is in these sheets: hover (120 ms), pressed
// (:active) and a focus ring on :focus-visible only, so a click never shows it.
// @cpt-begin:cpt-noter-flow-ui-primitives-operate-control:p1:inst-feedback
// @cpt-begin:cpt-noter-state-ui-primitives-push-button:p1:inst-default-hover
// @cpt-begin:cpt-noter-state-ui-primitives-push-button:p1:inst-hover-pressed
// @cpt-begin:cpt-noter-state-ui-primitives-push-button:p1:inst-default-focus
import "./components/00-base.css";
import "./components/01-macos27.css";
// @cpt-end:cpt-noter-state-ui-primitives-push-button:p1:inst-default-focus
// @cpt-end:cpt-noter-state-ui-primitives-push-button:p1:inst-hover-pressed
// @cpt-end:cpt-noter-state-ui-primitives-push-button:p1:inst-default-hover
// @cpt-end:cpt-noter-flow-ui-primitives-operate-control:p1:inst-feedback
import "./components/hit-area.css";
