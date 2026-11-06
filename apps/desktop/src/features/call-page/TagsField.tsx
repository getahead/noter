// The Tags row of Call info: chips and a field. Return or a comma adds, × or Backspace in the empty field removes;
// every change goes through `call_tags_set` and the undo strip. Suggestions are the tags in use (`tags_list`).
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { setTags, loadTags } from "./share-actions";
import { validateTag } from "./share-logic";

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1
export function TagsField({ bridge, callId, tags }: { bridge: Bridge; callId: string; tags: string[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  useEffect(() => void loadTags(bridge).then((r) => r.status === "ok" && setKnown(r.data.tags.map((x) => x.tag))), [bridge, tags.length]);

  const fail = () => setError(t("tags.failed"));
  const add = async (raw: string) => {
    const v = validateTag(raw, tags);
    if (!v.ok) return setError(v.error);
    setError(null);
    const r = await setTags(bridge, callId, [v.tag], []);
    if (r.status === "ok") setText("");
    else fail();
  };
  const remove = async (tag: string) => (await setTags(bridge, callId, [], [tag])).status === "ok" ? setError(null) : fail();

  return (
    <div className="pc-tags" data-component="tags-field">
      <div className="pc-tags__chips">
        {tags.map((x) => (
          <span key={x} className="pc-tag">
            {x}
            <button type="button" className="pc-tag__x" aria-label={t("tags.remove", { tag: x })} onClick={() => void remove(x)}>
              <Icon name="x" size={9} />
            </button>
          </span>
        ))}
      </div>
      <input
        className="np-field pc-tags__input"
        aria-label={t("tags.add")}
        placeholder={t("tags.add")}
        list={`tags-${callId}`}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => (setText(e.target.value), setError(null))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") (e.preventDefault(), void add(text));
          else if (e.key === "Backspace" && !text && tags.length) void remove(tags[tags.length - 1]!);
        }}
      />
      <datalist id={`tags-${callId}`}>{known.filter((x) => !tags.some((y) => y.toLowerCase() === x.toLowerCase())).map((x) => <option key={x} value={x} />)}</datalist>
      {error && <div role="alert" className="pc-sec__error">{error}</div>}
    </div>
  );
}
