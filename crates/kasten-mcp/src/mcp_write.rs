//! The write tools over MCP: their descriptions and schemas for
//! `tools/list`, each built by `tools` and run in the connection's session.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = write_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "A new card in the inbox from Markdown; its first line becomes the title."
    )]
    async fn capture(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<CaptureArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::capture(k, a)).await
    }

    #[tool(
        description = "A new card or page with a body, tags and properties, in a project, the inbox or the library, or under a parent page; optionally from a template."
    )]
    async fn create_note(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<CreateNoteArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::create_note(k, a))
            .await
    }

    #[tool(
        description = "Adds Markdown to a note, at its end or under a heading. Never removes text."
    )]
    async fn append(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<AppendArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::append(k, a)).await
    }

    #[tool(
        description = "Replaces the text under one heading, up to the next heading of the same level. Large removals wait for review."
    )]
    async fn replace_section(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<ReplaceSectionArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::replace_section(k, a))
            .await
    }

    #[tool(
        description = "Sets properties on a note, validated against its tags' schemas; null removes one. A project's status, health, next action and review days are set with set_project_state instead."
    )]
    async fn update_props(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<UpdatePropsArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::update_props(k, a))
            .await
    }

    #[tool(description = "Adds tags to a note.")]
    async fn add_tags(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<TagsArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::add_tags(k, a)).await
    }

    #[tool(description = "Removes tags from a note.")]
    async fn remove_tags(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<TagsArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::remove_tags(k, a))
            .await
    }

    #[tool(description = "Gives a note a new title; its file and every [[link]] to it follow.")]
    async fn rename_note(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<RenameArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::rename_note(k, a))
            .await
    }

    #[tool(
        description = "Moves a note and its sub-pages into a project, or with no project to the library."
    )]
    async fn move_note(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<MoveArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::move_note(k, a)).await
    }

    #[tool(
        description = "Adds Markdown to a day's journal, today (UTC) by default, creating the day if needed."
    )]
    async fn journal_append(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<JournalAppendArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::journal_append(k, a))
            .await
    }

    #[tool(
        description = "Many changes as one: up to 100 (1 MB), each a write tool's name and arguments. All are made or none, as one change that one undo takes back. One refused change refuses the batch and names it; if any change needs review the whole batch waits as one proposal. Prefer it to many separate calls. Name notes that exist already."
    )]
    async fn batch(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<BatchArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::batch_op(k, a)).await
    }

    #[tool(
        description = "Moves a note, and every sub-page inside it, to the trash, where the user can restore them. Never deletes."
    )]
    async fn trash_note(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<TrashArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::trash_note(k, a)).await
    }

    #[tool(
        description = "Sends a full rewrite of a note's body to the user's review queue. Prefer replace_section or append."
    )]
    async fn propose_edit(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<ProposeEditArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::propose_edit(k, a))
            .await
    }

    #[tool(
        description = "Proposes a new template for pages or cards: its body, tags, properties and icon. Always waits for the user's review."
    )]
    async fn create_template(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<CreateTemplateArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::create_template(k, a))
            .await
    }

    #[tool(
        description = "Proposes a new body for an existing template; its frontmatter stays. Always waits for the user's review."
    )]
    async fn update_template(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<UpdateTemplateArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::update_template(k, a))
            .await
    }

    #[tool(
        description = "Proposes a tag's schema: its colour, properties and views. A property of type formula is worked out when the rows are read and is never written to a note, for example {key: days_left, type: formula, formula: \"days_until(deadline)\"}; a formula that does not parse, or names a property the tag lacks, is refused with the position of the mistake. Always waits for review."
    )]
    async fn update_tag_schema(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<TagSchemaArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::update_tag_schema(k, a))
            .await
    }
}
