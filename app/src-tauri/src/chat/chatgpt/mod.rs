//! Sign in with ChatGPT: the person's ChatGPT plan pays for chats and AI
//! writing, through OpenAI's Responses API, with no API key. The sign-in is
//! OpenID Connect with PKCE and a loopback redirect (oauth.rs, pkce.rs,
//! callback.rs, flow.rs); the account and its tokens live in session.rs,
//! with only the refresh token in the keychain. Requests are built and read
//! in chat/responses.rs.

pub mod authorize;
pub mod callback;
pub mod commands;
pub mod flow;
pub mod models;
pub mod oauth;
pub mod pkce;
pub mod session;
pub mod words;

pub use session::{Account, SIGN_IN_FIRST, signed_in};
