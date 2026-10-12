//! The example slides a template brings: a title, a section, a content slide, two columns, a picture
//! beside words, a quote and a closing slide. They are the same words in every theme, so the themes
//! can be compared slide for slide, and they are ordinary slides the person keeps or deletes.

/// One example slide: the layout, the Markdown of each slot (by role), the speaker notes, and whether
/// a stand-in for a picture goes where the layout's picture slot is.
pub struct Example {
    pub layout: &'static str,
    pub content: &'static [(&'static str, &'static str)],
    pub notes: &'static str,
    pub picture: bool,
}

/// Stands for the deck's title in the first slide's words.
pub const TITLE: &str = "{title}";

/// What the stand-in for a picture says.
pub const PICTURE_WORDS: &str = "Drop a picture here";

/// The example slides, in the order a deck starts with them.
pub const EXAMPLES: [Example; 7] = [
    Example {
        layout: "title",
        content: &[("title", TITLE), ("subtitle", "Your name, and the date")],
        notes: "These example slides show the template's layouts. Keep the ones you need and delete the rest.",
        picture: false,
    },
    Example {
        layout: "section",
        content: &[
            ("title", "A section title"),
            ("subtitle", "One line that says what this part is about"),
        ],
        notes: "",
        picture: false,
    },
    Example {
        layout: "title-body",
        content: &[
            ("title", "A slide with a list"),
            (
                "body",
                "- Give each slide one idea\n- Three short points read best\n- Say the rest aloud, and keep it in the notes",
            ),
        ],
        notes: "",
        picture: false,
    },
    Example {
        layout: "two-columns",
        content: &[
            ("title", "Two things side by side"),
            (
                "body",
                "- The first thing\n- What is good about it\n- What to watch for",
            ),
            (
                "body2",
                "- The second thing\n- What is good about it\n- What to watch for",
            ),
        ],
        notes: "",
        picture: false,
    },
    Example {
        layout: "title-image",
        content: &[
            ("title", "A picture with words"),
            (
                "body",
                "- Say what the picture shows\n- Point out the one thing to see",
            ),
        ],
        notes: "",
        picture: true,
    },
    Example {
        layout: "quote",
        content: &[
            ("quote", "A good quotation sets the tone for what follows."),
            ("caption", "Who said it, and where"),
        ],
        notes: "",
        picture: false,
    },
    Example {
        layout: "title",
        content: &[
            ("title", "Thank you"),
            ("subtitle", "Questions and comments are welcome"),
        ],
        notes: "",
        picture: false,
    },
];
