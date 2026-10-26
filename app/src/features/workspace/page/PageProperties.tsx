// A page's tags and properties under its title, as in Notion. Hidden while
// the page has none; "Add property" in the header's controls shows them.
// The editors are the right panel's (panel/properties), so a value edited
// here or there is the same edit.

import "../../panel/properties/chips.css";
import "../../panel/properties/properties.css";
import "./page-properties.css";

import type { NoteMeta } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import type { PanelPage } from "../../panel/page-edit";
import { PropField } from "../../panel/properties/fields";
import { NewProperty, OtherRows } from "../../panel/properties/OtherProperties";
import { TagEditor } from "../../panel/properties/TagEditor";
import { usePropertyEdits } from "../../panel/properties/use-property-edits";
import { propOf } from "../../panel/properties/values";
import { FoldBar, useFolded } from "./PropertiesFold";

interface PagePropertiesProps {
  note: NoteMeta;
  page: PanelPage;
  /** A new property is being named. */
  adding: boolean;
  onAdding(adding: boolean): void;
}

export function PageProperties({ note, page, adding, onAdding }: PagePropertiesProps) {
  const { schemas, tags, props, groups, otherKeys, saveProp, changeTags } = usePropertyEdits(note, page);
  const folded = useFolded(note, adding);
  if (!adding && tags.length === 0 && Object.keys(props).length === 0) return null;
  // One row per key, though two tags' schemas may both name it.
  const seen = new Set<string>();
  const typed = groups.flatMap(({ tag, schema }) => schema.properties.filter((def) => !seen.has(def.key) && seen.add(def.key)).map((def) => ({ tag, def })));

  return (
    <section className="kasten-page-props kasten-page-column" aria-label="Properties">
      <FoldBar note={note} folded={folded} />
      {!folded && (
      <>
      <dl className="kasten-props">
        <div className="kasten-prop">
          <dt>
            <Icon name="tag" className="size-4" /> Tags
          </dt>
          <dd>
            <TagEditor tags={tags} schemas={schemas} onAdd={(tag) => void changeTags([tag], [])} onRemove={(tag) => void changeTags([], [tag])} />
          </dd>
        </div>
        {typed.map(({ tag, def }) => (
          <div key={def.key} className="kasten-prop">
            <dt title={`#${tag} · ${def.type.replace("_", " ")}`}>
              <Icon name="list" className="size-4" /> {def.key}
            </dt>
            <dd>
              <PropField def={def} value={propOf(props, def.key)} label={def.key} self={note.path} onSave={(value) => void saveProp(def.key, value)} />
            </dd>
          </div>
        ))}
        {schemas !== null && <OtherRows keys={otherKeys} props={props} onSave={(key, value) => void saveProp(key, value)} />}
      </dl>
      {adding ? (
        <NewProperty
          taken={Object.keys(props)}
          onCancel={() => onAdding(false)}
          onAdd={(key, value) => {
            onAdding(false);
            void saveProp(key, value);
          }}
        />
      ) : (
        <button type="button" className="kasten-page-props-add" onClick={() => onAdding(true)}>
          <Icon name="plus" className="size-4" /> Add property
        </button>
      )}
      </>
      )}
    </section>
  );
}
