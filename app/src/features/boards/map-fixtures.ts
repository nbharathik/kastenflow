// A page with headings and lists, for the tests of mind maps.

export const TRIP = `A week by the sea.

## Where to stay
- The old town, near the castle
- Baixa
  - close to the trams

## What to eat
1. **Pastéis** de nata
2. Bacalhau, see [[Recipes|the recipe]]

Some notes that are not part of the map.

### Before we go
- [ ] Flights
- [x] Insurance

\`\`\`
- not a list, code
\`\`\`
`;

/** A project and the trip page in it (a page with an id, as Kasten makes them). */
export const SEED = {
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  "projects/trip/pages/seaside.md": `---\ntitle: Seaside trip\nid: 01J8ZQ6K3VPAGEAAAAAAAAAAAA\n---\n${TRIP}`,
};
