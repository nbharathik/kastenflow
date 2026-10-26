//! The tools for what a person does with the page menu, the journal, to-dos,
//! comments, saved searches, the bibliography, whiteboards and the history:
//! their descriptions and schemas for `tools/list`, each built by `tools` and
//! run in the connection's session.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_parity::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = parity_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Makes a copy of a page or card next to it, with its comments. Use it to start from an existing note without changing it. Locked notes are refused."
    )]
    async fn duplicate_note(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<DuplicateNoteArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::duplicate_note(k, a))
            .await
    }

    #[tool(
        description = "Brings a note back from the trash, with the sub-pages that went with it. Name it by its title or by the path list_trash gives. It comes back where it was, or beside that under a free name if the place is taken."
    )]
    async fn restore_note(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<RestoreNoteArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::restore_note(k, a))
            .await
    }

    #[tool(
        description = "Changes one setting in a page's header: icon, cover, font (sans, serif, mono), width (normal, wide, full), text size (small, normal, large, xl) or layout (sections). Use rename_note for the title. A page's lock is only ever the user's to set. Locked pages are refused."
    )]
    async fn set_note_meta(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SetNoteMetaArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::set_note_meta(k, a))
            .await
    }

    #[tool(
        description = "Fills an empty page from a template (list_templates names them), with the template's text and settings. A page that has text is refused, so a template never writes over writing."
    )]
    async fn apply_template(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<ApplyTemplateArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::apply_template(k, a))
            .await
    }

    #[tool(
        description = "Opens a day of the journal and makes it from the journal template if it is not there yet (today by default). get_journal only reads; use journal_append to add text to a day."
    )]
    async fn journal_day(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<JournalDayArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::journal_day(k, a))
            .await
    }

    #[tool(
        description = "Ticks or unticks one to-do (a `- [ ]` line) in a note, changing only that check box. Give the line and the note's hash from list_tasks; a note that changed since is refused, so read the to-dos again."
    )]
    async fn set_task(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SetTaskArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::set_task(k, a)).await
    }

    #[tool(
        description = "Notes in the trash that can come back, newest first, with where each was. Use restore_note to bring one back.",
        annotations(read_only_hint = true)
    )]
    async fn list_trash(&self) -> CallToolResult {
        self.run(tools::list_trash).await
    }

    #[tool(
        description = "The to-dos of the whole vault as the Tasks view lists them: open ones first, overdue before dated before undated. Filter by status, day, where they live and words. Each carries the line and the note's hash that set_task needs.",
        annotations(read_only_hint = true)
    )]
    async fn list_tasks(&self, Parameters(a): Parameters<ListTasksArgs>) -> CallToolResult {
        self.run(move |k| tools::list_tasks(k, a)).await
    }

    #[tool(
        description = "Every project at a glance: its status and health, what it does next, when it is due for review, its open to-dos and how many notes, boards and decks it holds. Use it before changing a project (set_project_state).",
        annotations(read_only_hint = true)
    )]
    async fn list_projects(&self, Parameters(a): Parameters<ListProjectsArgs>) -> CallToolResult {
        self.run(move |k| tools::list_projects(k, a)).await
    }

    #[tool(
        description = "Adds a comment to a page, signed by you, about the whole page, a section or some words in it. Use it to point something out to the user without changing their text. Locked pages are refused."
    )]
    async fn add_comment(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<AddCommentArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::add_comment(k, a))
            .await
    }

    #[tool(
        description = "Resolves a comment on a page, or opens it again. Comments are never deleted."
    )]
    async fn resolve_comment(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<ResolveCommentArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::resolve_comment(k, a))
            .await
    }

    #[tool(
        description = "The comments on a page with their ids, who wrote them and whether they are resolved.",
        annotations(read_only_hint = true)
    )]
    async fn list_comments(&self, Parameters(a): Parameters<ListCommentsArgs>) -> CallToolResult {
        self.run(move |k| tools::list_comments(k, a)).await
    }

    #[tool(
        description = "The saved searches (collections): name, query, filters, sort and how they show, with the hash update_collection needs.",
        annotations(read_only_hint = true)
    )]
    async fn list_collections(&self) -> CallToolResult {
        self.run(tools::list_collections).await
    }

    #[tool(
        description = "Saves a search under a name, such as \"#paper project:thesis\" shown as a table. It stores the search and not the notes it finds. Renaming and deleting saved searches stay with the user."
    )]
    async fn create_collection(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<CreateCollectionArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::create_collection(k, a))
            .await
    }

    #[tool(
        description = "Changes the settings of a saved search (query, when, filter, sort, display, icon); other lines of its file stay as they are. Give the hash from list_collections; a search that changed since is refused."
    )]
    async fn update_collection(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<UpdateCollectionArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::update_collection(k, a))
            .await
    }

    #[tool(
        description = "The vault's bibliography: references with their keys and fields, filtered by words. Pages and slides cite a key as [@key].",
        annotations(read_only_hint = true)
    )]
    async fn list_references(
        &self,
        Parameters(a): Parameters<ListReferencesArgs>,
    ) -> CallToolResult {
        self.run(move |k| tools::list_references(k, a)).await
    }

    #[tool(
        description = "Adds a reference to the vault's bibliography. A work that is there already (same key, DOI or arXiv number) is refused. It always waits for the user's review unless they let you work on your own."
    )]
    async fn add_reference(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<AddReferenceArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::add_reference(k, a))
            .await
    }

    #[tool(
        description = "Changes a whiteboard with steps: add_sticky, move, resize, remove, restyle (colours) and edge_style (an arrow's label, colour, ends, line and dashes). Ids come from read_board. All steps are made or none. Taking many nodes off at once waits for the user."
    )]
    async fn board_edit(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<BoardEditArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::board_edit(k, a)).await
    }

    #[tool(
        description = "Sessions of agents that changed the vault, newest first, with how many changes each made and whether they were all taken back. Yours is the one you are working in.",
        annotations(read_only_hint = true)
    )]
    async fn list_sessions(&self, Parameters(a): Parameters<ListSessionsArgs>) -> CallToolResult {
        self.run(move |k| tools::list_sessions(k, a)).await
    }

    #[tool(
        description = "What agents did lately, session by session, read from the history: each session's client name (a routine's name), how many changes it made, which notes it touched, how many proposals of it wait for the user, and whether it can still be taken back. The user's own edits are never in it. Use it to say what changed while you were away, or to see what another routine did before you start.",
        annotations(read_only_hint = true)
    )]
    async fn activity_digest(
        &self,
        Parameters(a): Parameters<ActivityDigestArgs>,
    ) -> CallToolResult {
        self.run(move |k| tools::activity_digest(k, a)).await
    }

    #[tool(
        description = "Takes back every change of a session, newest first, keeping edits the user made since; a change they edited on the same lines stops it and is reported. Without a session it takes back your own. Another session's changes wait for the user's review, unless the user has let you work on your own: then they are taken back at once, so name another session only when asked to. A person's own changes are never taken back."
    )]
    async fn undo_session(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<UndoSessionArgs>,
    ) -> CallToolResult {
        let own = self.session(&context).id;
        self.agent(&context, move |k| tools::undo_session(k, a, &own))
            .await
    }
}
