//! What can go wrong reading a deck or applying an operation. Every message
//! says what to change, because an agent reads them too.

use std::fmt;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Error {
    /// The text is not JSON, or does not have the shape of a deck.
    Malformed {
        message: String,
    },
    /// The file is a deck of a newer version than this build reads.
    TooNew {
        found: u32,
        supported: u32,
    },
    /// The deck reads, but breaks a rule of the format.
    Invalid {
        message: String,
    },
    UnknownOp {
        name: String,
    },
    /// The operation's input does not fit it.
    BadInput {
        op: String,
        message: String,
    },
    NoSuchSlide {
        id: String,
    },
    NoSuchElement {
        slide: String,
        id: String,
    },
    /// Something the operation was asked to do that the deck does not allow.
    Refused {
        message: String,
    },
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn malformed(message: impl fmt::Display) -> Error {
        Error::Malformed {
            message: message.to_string(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Error {
        Error::Invalid {
            message: message.into(),
        }
    }

    pub fn bad_input(op: &str, message: impl fmt::Display) -> Error {
        Error::BadInput {
            op: op.to_owned(),
            message: message.to_string(),
        }
    }

    pub fn refused(message: impl Into<String>) -> Error {
        Error::Refused {
            message: message.into(),
        }
    }

    pub fn no_slide(id: &str) -> Error {
        Error::NoSuchSlide { id: id.to_owned() }
    }

    pub fn no_element(slide: &str, id: &str) -> Error {
        Error::NoSuchElement {
            slide: slide.to_owned(),
            id: id.to_owned(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Malformed { message } => write!(f, "Not a readable deck: {message}"),
            Error::TooNew { found, supported } => write!(
                f,
                "This deck is format version {found}; this build reads up to {supported}. Update KastenFlow Slides to open it."
            ),
            Error::Invalid { message } => {
                write!(f, "The deck breaks a rule of the format: {message}")
            }
            Error::UnknownOp { name } => write!(f, "There is no operation called `{name}`."),
            Error::BadInput { op, message } => {
                write!(f, "`{op}` was given input it cannot use: {message}")
            }
            Error::NoSuchSlide { id } => write!(f, "There is no slide `{id}` in the deck."),
            Error::NoSuchElement { slide, id } => {
                write!(f, "There is no element `{id}` on slide `{slide}`.")
            }
            Error::Refused { message } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for Error {}
