// The template gallery's shelves: every template in the vault's
// `templates/` folder, grouped and described. Kasten's starter templates
// have a line of their own here; a template the owner wrote goes under
// "Your templates" with its first line as the description.

import type { NoteMeta } from "../../lib/vault/types";
import { iconOf, templateIcon } from "../workspace/names";
import { templateName, templates } from "../workspace/tree";

export const CATEGORIES = ["Basics", "Daily and reviews", "Knowledge", "Work", "Study and research", "Life", "Travel", "Writing and ideas", "Your templates"] as const;
export type Category = (typeof CATEGORIES)[number];

interface Known {
  label: string;
  category: Category;
  description: string;
}

/** Starter templates by file name (`crates/kasten-core/defaults/templates`). */
const KNOWN: Record<string, Known> = {
  page: { label: "Empty page", category: "Basics", description: "A blank page with a title." },
  "daily-planner": { label: "Daily planner", category: "Daily and reviews", description: "Today's top three, a schedule, to-dos and an end-of-day check." },
  "morning-pages": { label: "Morning pages", category: "Daily and reviews", description: "Three pages of free writing to start the day." },
  "evening-reflection": { label: "Evening reflection", category: "Daily and reviews", description: "What went well, what you learned and tomorrow's first step." },
  "weekly-plan": { label: "Weekly plan", category: "Daily and reviews", description: "The week's outcomes first, then a focus for each day." },
  "monthly-review": { label: "Monthly review", category: "Daily and reviews", description: "Highlights, goals, numbers and what to change next month." },
  "quarterly-goals": { label: "Quarterly goals", category: "Daily and reviews", description: "Two or three goals with results to count and monthly check-ins." },
  "year-in-review": { label: "Year in review", category: "Daily and reviews", description: "The year month by month, its best moments and a theme for the next." },
  "fleeting-note": { label: "Fleeting note", category: "Knowledge", description: "A thought caught fast, to turn into a permanent note or let go." },
  "literature-note": { label: "Literature note", category: "Knowledge", description: "One idea from a source, in your own words, with where it could go." },
  "permanent-note": { label: "Permanent note", category: "Knowledge", description: "One idea stated fully, linked to what it builds on and leads to." },
  "map-of-content": { label: "Map of content", category: "Knowledge", description: "An entry point to a topic: the notes that matter, in order." },
  "book-notes": { label: "Book notes", category: "Knowledge", description: "The book in three sentences, ideas, quotes and what changed." },
  "course-notes": { label: "Course notes", category: "Knowledge", description: "Modules to tick off, notes by module, exercises and questions." },
  "podcast-notes": { label: "Podcast or video", category: "Knowledge", description: "Notes with timestamps and ideas to follow up." },
  "article-notes": { label: "Article notes", category: "Knowledge", description: "The argument, its evidence and where you agree." },
  card: { label: "Card", category: "Basics", description: "A small note for one idea, for boards and the inbox." },
  project: { label: "Project", category: "Basics", description: "Goals, milestones, tasks and links for a new project." },
  meeting: { label: "Meeting notes", category: "Work", description: "Agenda, notes, decisions and action items." },
  "one-on-one": { label: "1:1", category: "Work", description: "A running agenda for one-to-one meetings, with growth and follow-ups." },
  "project-brief": { label: "Project brief", category: "Work", description: "Why, scope, success, timeline, people and risks on one page." },
  "product-spec": { label: "Product spec", category: "Work", description: "Problem, goals, stories, requirements, design and open questions." },
  "bug-report": { label: "Bug report", category: "Work", description: "Steps to reproduce, expected and actual, and the fix." },
  decision: { label: "Decision", category: "Work", description: "Context, options with trade-offs, the decision and its consequences." },
  retrospective: { label: "Retrospective", category: "Work", description: "What went well, what was hard, and what to try next." },
  "meeting-series": { label: "Meeting series", category: "Work", description: "One page for a recurring meeting, newest on top." },
  interview: { label: "Interview", category: "Work", description: "Questions, notes, signals and a recommendation." },
  "weekly-status": { label: "Weekly status", category: "Work", description: "Done, next, risks and asks, for someone who reads only this." },
  "project-kickoff": { label: "Project kickoff", category: "Work", description: "Why, what done looks like, people, milestones and risks." },
  "project-update": { label: "Project update", category: "Work", description: "Progress, decisions, blockers and the next action, dated." },
  paper: { label: "Paper", category: "Study and research", description: "A paper draft with abstract, sections and references." },
  reading: { label: "Reading notes", category: "Knowledge", description: "Source, summary, key ideas, quotes and your thoughts." },
  "literature-review": { label: "Literature review", category: "Study and research", description: "Sources in a table, themes, gaps and what to read next." },
  experiment: { label: "Experiment", category: "Study and research", description: "Hypothesis, setup and results." },
  lecture: { label: "Lecture notes", category: "Study and research", description: "Notes from a class or talk, with questions to follow up." },
  "study-plan": { label: "Study plan", category: "Study and research", description: "Topics by confidence, a weekly plan, resources and practice." },
  "thesis-chapter": { label: "Thesis chapter", category: "Study and research", description: "The argument, outline, draft, evidence and feedback." },
  goals: { label: "Goals", category: "Daily and reviews", description: "An objective with measurable key results and check-ins." },
  "weekly-review": { label: "Weekly review", category: "Daily and reviews", description: "Wins, loose ends and next week's top three." },
  "habit-tracker": { label: "Habit tracker", category: "Daily and reviews", description: "A week of habits to tick, day by day." },
  budget: { label: "Monthly budget", category: "Life", description: "Income, spending by category and saving goals." },
  recipe: { label: "Recipe", category: "Life", description: "Ingredients to tick off, steps and notes for next time." },
  workout: { label: "Workout", category: "Life", description: "Warm-up, main set with weights and how it went." },
  person: { label: "Person", category: "Life", description: "Who someone is, what you talked about and follow-ups." },
  event: { label: "Event", category: "Life", description: "Schedule, guest list, to-dos and budget for a party or gathering." },
  area: { label: "Area", category: "Life", description: "Something you look after with no end date, its projects and routines." },
  "reading-list": { label: "Reading list", category: "Life", description: "What to read next, what you're reading and what you finished." },
  "meal-plan": { label: "Meal plan", category: "Life", description: "A week of meals and the shopping list." },
  gratitude: { label: "Gratitude", category: "Life", description: "Three good things and someone to thank." },
  travel: { label: "Trip plan", category: "Travel", description: "Itinerary by day, bookings, packing, places and budget." },
  "packing-list": { label: "Packing list", category: "Travel", description: "Everything to take, by kind, to untick and reuse." },
  "city-guide": { label: "City guide", category: "Travel", description: "Neighbourhoods, places to eat and see, and getting around." },
  "road-trip": { label: "Road trip", category: "Travel", description: "Driving legs, stops worth it, the car checklist and costs." },
  brainstorm: { label: "Brainstorm", category: "Writing and ideas", description: "Every idea first, then clusters, a pick and next steps." },
  "blog-post": { label: "Blog post", category: "Writing and ideas", description: "Takeaway, hook, outline, draft and a publishing checklist." },
  "job-application": { label: "Job application", category: "Writing and ideas", description: "Why the role, your evidence, interviews and people." },
  "content-idea": { label: "Content idea", category: "Writing and ideas", description: "Who it's for, the angle, an outline and where it goes." },
  newsletter: { label: "Newsletter", category: "Writing and ideas", description: "Subject lines, the main piece, links and a send checklist." },
};

/** Templates not offered for new pages: journal days have their own. */
const HIDDEN = new Set(["journal"]);

export interface TemplateInfo {
  name: string;
  label: string;
  icon: string;
  category: Category;
  description: string;
  note: NoteMeta;
}

const sentence = (label: string) => (label.charAt(0).toUpperCase() + label.slice(1)).replace(/[-_]/g, " ");

/** Every template the vault has, in gallery order. */
export function catalog(notes: readonly NoteMeta[]): TemplateInfo[] {
  const out = templates(notes)
    .map((note): TemplateInfo | null => {
      const name = templateName(note);
      if (HIDDEN.has(name)) return null;
      const known = KNOWN[name];
      return {
        name,
        label: known?.label ?? sentence(name),
        icon: note.icon ? iconOf(note) : templateIcon(name),
        category: known?.category ?? "Your templates",
        description: known?.description ?? (note.excerpt || "A template of your own."),
        note,
      };
    })
    .filter((t): t is TemplateInfo => t !== null);
  const order = (t: TemplateInfo) => CATEGORIES.indexOf(t.category);
  const known = Object.keys(KNOWN);
  return out.sort((a, b) => order(a) - order(b) || known.indexOf(a.name) - known.indexOf(b.name) || a.label.localeCompare(b.label));
}

/** Templates matching a search, by label, description or category. */
export function filterCatalog(list: TemplateInfo[], query: string): TemplateInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((t) => `${t.label} ${t.description} ${t.category} ${t.name}`.toLowerCase().includes(q));
}
