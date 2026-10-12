import "./overlays.css";

import { useShell } from "../../../lib/store";
import { KEY_SECTIONS, commandLabel, editorKeys } from "../../shortcuts/catalog";
import { formatBinding, isMac } from "../../shortcuts/keymap";
import { useKeys } from "../../shortcuts/store";
import { openSettingsAt } from "../views/settings/jump";
import { EDITOR_SHORTCUTS } from "./commands";
import { Icon } from "../../../ui/Icon";
import { Modal } from "../../../ui/Modal";

type Section = { title: string; rows: [string, string][] };

/** Clicks that choose where a page opens; not keys, so not configurable. */
const CLICKS: [string, string][] = [
  ["Ctrl+click", "Open a link or page in a new tab"],
  ["Shift+click", "Open it in the side stack"],
  ["Alt+click", "Open it in a split"],
];

/** The person's keys for the first two sections: commands with a key. */
function keySections(keymap: Record<string, string[]>): Section[] {
  const mac = isMac();
  return KEY_SECTIONS.slice(0, 2).map(({ title, ids }) => ({
    title,
    rows: ids.filter((id) => keymap[id]?.length).map((id): [string, string] => [keymap[id]!.map((k) => formatBinding(k, mac)).join(" or "), commandLabel(id)]),
  }));
}

/** Every shortcut on one sheet, as Notion's "Keyboard shortcuts". */
export function ShortcutsHelp() {
  const keymap = useKeys((s) => s.keymap);
  const close = () => useShell.getState().setShortcuts(false);
  const [anywhere, tabs] = keySections(keymap);
  const sections: Section[] = [
    anywhere!,
    { title: tabs!.title, rows: [...tabs!.rows, ...CLICKS.map(([keys, action]): [string, string] => [editorKeys(keys), action])] },
    ...EDITOR_SHORTCUTS.map((section) => ({ ...section, rows: section.rows.map(([keys, action]): [string, string] => [editorKeys(keys), action]) })),
  ];
  return (
    <Modal plain label="Keyboard shortcuts" onClose={close} className="kasten-shortcuts">
      <div className="kasten-shortcuts-bar">
        <h2>Keyboard shortcuts</h2>
        <button
          type="button"
          className="kasten-shortcuts-edit"
          onClick={() => {
            close();
            openSettingsAt({ group: "shortcuts", row: "shortcuts.editor" });
          }}
        >
          Change keys…
        </button>
        <button type="button" aria-label="Close" onClick={close}>
          <Icon name="close" className="size-4" />
        </button>
      </div>
      <div className="kasten-shortcuts-grid">
        {sections.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <table>
              <tbody>
                {section.rows.map(([keys, action]) => (
                  <tr key={keys + action}>
                    <td>{action}</td>
                    <td>
                      <kbd>{keys}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Modal>
  );
}
