// The actions beside a tag database's views, in its own tab and inside a page:
// Properties and New are icons (the name and the tooltip carry the word, the
// property count sits beside the icon), and "Add existing pages" keeps its
// words because nothing else says what it does.

import { Icon } from "../../ui/Icon";

interface Props {
  /** How many properties the tag has. */
  properties: number;
  onProperties(): void;
  onAddExisting(): void;
  onNew(): void;
}

export function DatabaseTools({ properties, onProperties, onAddExisting, onNew }: Props) {
  const name = properties > 0 ? `Properties (${properties})` : "Properties";
  return (
    <>
      <button type="button" className="kasten-tagdb-button is-icon" aria-label={name} title={`${name}: the details notes carry`} onClick={onProperties}>
        <Icon name="sliders" className="size-4" />
        {properties > 0 && <span className="kasten-tagdb-count">{properties}</span>}
      </button>
      <button type="button" className="kasten-tagdb-button" onClick={onAddExisting}>
        Add existing pages
      </button>
      <button type="button" className="kasten-tagdb-button is-icon is-primary" aria-label="New note" title="New note" onClick={onNew}>
        <Icon name="plus" className="size-4" />
      </button>
    </>
  );
}
