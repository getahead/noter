import { FakeCore } from "../../src/core/fake/fake-core";

/** Wrap a fake core so a test can assert which commands and arguments a component sent. */
export function sentCommands(fake: FakeCore): Array<[string, unknown]> {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, ...args: unknown[]) => {
    seen.push([cmd, args[0]]);
    return (invoke as (...a: unknown[]) => unknown)(cmd, ...args);
  }) as typeof fake.invoke;
  return seen;
}
