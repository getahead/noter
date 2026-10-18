// Test helpers for the unit environment, which has no DOM: run a component's render (hooks included) and
// reach its elements, so a test can call their handlers.
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";

type Props = Record<string, unknown> & { children?: ReactNode };

/** The element tree a component renders for `props`; its hooks run inside a probe component's render. */
export function rendered<P>(Comp: (props: P) => ReactNode, props: P): ReactElement<Props> {
  let out: ReactNode = null;
  const Probe = () => ((out = Comp(props)), null);
  renderToString(<Probe />);
  return out as unknown as ReactElement<Props>;
}

/** The first element of `tree` (depth first) that matches `test`. */
export function find(tree: ReactNode, test: (props: Props, type: unknown) => boolean): ReactElement<Props> {
  const walk = (node: ReactNode): ReactElement<Props> | undefined => {
    if (!isValidElement<Props>(node)) return undefined;
    if (test(node.props, node.type)) return node;
    for (const child of Children.toArray(node.props.children)) {
      const hit = walk(child);
      if (hit) return hit;
    }
  };
  const hit = walk(tree);
  if (!hit) throw new Error("no matching element");
  return hit;
}
