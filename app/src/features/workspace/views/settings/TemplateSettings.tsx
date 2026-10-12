// Settings → Templates: how many there are, the gallery, the template new
// journal days start from, and starter templates a newer Kasten added
// since this vault was made.

import { useEffect, useState } from "react";

import { useShell } from "../../../../lib/store";
import { Button } from "../../../../ui/Button";
import { useWorkspace } from "../../store";
import { titleOf } from "../../names";
import { templates } from "../../tree";
import { Group, Row } from "./parts";

export function TemplateSettings() {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const [missing, setMissing] = useState<string[]>([]);
  const [journal, setJournal] = useState<string | null>(null);

  useEffect(() => {
    client?.getConfig().then((config) => setJournal(config.journal_template ?? "journal"), () => {});
  }, [client]);

  const chooseJournal = async (name: string) => {
    if (!client) return;
    try {
      // Read again first: other groups write the same file.
      const current = await client.getConfig();
      await client.setConfig({ ...current, journal_template: name === "journal" ? null : name });
      setJournal(name);
      useWorkspace.getState().toast("New journal days start from this template");
    } catch (err) {
      useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
    }
  };
  const choices = templates(notes).map((t) => ({ name: t.path.replace(/^templates\//, "").replace(/\.md$/, ""), label: titleOf(t) }));

  useEffect(() => {
    client?.missingTemplates().then(setMissing, () => {});
  }, [client, notes]);

  const addStarters = async () => {
    if (!client) return;
    const added = await client.addStarterTemplates().catch(() => []);
    await useWorkspace.getState().refresh();
    setMissing([]);
    useWorkspace.getState().toast(`Added ${added.length} template${added.length === 1 ? "" : "s"}`);
  };

  return (
    <Group title="Templates">
      <Row id="templates.count" label={`${templates(notes).length} templates`}>
        <Button size="sm" icon="gallery" onClick={() => useShell.getState().openGallery({})}>
          Browse
        </Button>
      </Row>
      {journal !== null && (
        <Row id="templates.journal">
          <select aria-label="Journal days start from" value={journal} onChange={(e) => void chooseJournal(e.target.value)} className="ui-field kasten-set-select">
            {!choices.some((c) => c.name === "journal") && <option value="journal">Journal</option>}
            {choices.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name === "journal" ? `${c.label} (the usual)` : c.label}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row id="templates.kits">
        <Button size="sm" icon="gallery" onClick={() => useShell.getState().openGallery({ kits: true })}>
          Browse kits
        </Button>
      </Row>
      {missing.length > 0 && (
        <Row id="templates.missing" label={`${missing.length} new starter template${missing.length === 1 ? "" : "s"}`} detail={missing.slice(0, 6).join(", ") + (missing.length > 6 ? "…" : "")}>
          <Button size="sm" tone="primary" onClick={() => void addStarters()}>
            Add them
          </Button>
        </Row>
      )}
    </Group>
  );
}
