import { useEffect } from "react";

import { Block, Group, Row } from "../features/workspace/views/settings/parts";
import "./plugins.css";
import { CATALOG } from "./catalog";
import { PluginCard, type CardData } from "./PluginCard";
import { usePlugins } from "./registry";
import type { CatalogEntry } from "./types";

/** The cards to draw: what the app lists, or, with no app to ask, what this build's catalogue holds. */
export function cardsOf(info: ReturnType<typeof usePlugins.getState>["info"], catalog: readonly CatalogEntry[]): CardData[] {
  const icon = (id: string) => catalog.find((e) => e.manifest.id === id)?.manifest.icon ?? "plug";
  if (info.length > 0) return info.map((p) => ({ id: p.id, name: p.name, summary: p.summary, icon: icon(p.id), scope: p.scope, bytes: p.payload?.sizeBytes ?? null }));
  return catalog.map(({ manifest: m }) => ({ id: m.id, name: m.name, summary: m.summary, icon: m.icon, scope: m.scope, bytes: m.payload?.bytes ?? null }));
}

/** Settings → Plugins: what can be switched on to add to KastenFlow. */
export function PluginsSettings({ catalog = CATALOG }: { catalog?: readonly CatalogEntry[] }) {
  const info = usePlugins((s) => s.info);
  useEffect(() => {
    void usePlugins.getState().sync(catalog);
  }, [catalog]);
  const cards = cardsOf(info, catalog);
  return (
    <Group title="Plugins">
      {cards.length === 0 ? (
        <Row id="plugins.list" detail="No plugins yet. Extra tools will appear here." />
      ) : (
        <Block id="plugins.list">
          {cards.map((card) => (
            <PluginCard key={card.id} data={card} catalog={catalog} />
          ))}
        </Block>
      )}
    </Group>
  );
}
