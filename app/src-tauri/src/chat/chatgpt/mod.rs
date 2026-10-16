//! Sign in with ChatGPT: the person's ChatGPT plan pays for chats and AI
//! writing, through OpenAI's Responses API, with no API key. The sign-in is
//! OpenID Connect with PKCE and a loopback redirect (oauth.rs, pkce.rs,
//! callback.rs, flow.rs); the ID token it returns is checked against
//! OpenAI's published keys before anyone is believed (idtoken.rs,
//! jwks.rs); the account and its tokens live in session.rs, with only the
//! refresh token and who it is for in the keychain (saved.rs), and are
//! renewed by a task that always runs to its end (renew.rs). What requests
//! found out about each model is kept in efforts.rs. Requests are built and
//! read in chat/responses.rs.

pub mod authorize;
pub mod callback;
pub mod commands;
pub mod efforts;
pub mod flow;
pub mod hold;
pub mod idtoken;
pub mod jwks;
pub mod models;
pub mod oauth;
pub mod pkce;
pub mod renew;
pub mod saved;
pub mod session;
#[cfg(test)]
pub(crate) mod test_keys;
pub mod words;

pub use efforts::{Feature, Tried};
pub use saved::signed_in;
pub use session::{Account, SIGN_IN_AGAIN, SIGN_IN_FIRST};
