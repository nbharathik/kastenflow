//! The picture of a video on the web: YouTube's thumbnail of it, or the one Vimeo's oEmbed answer names. The editor keeps what comes back
//! with the deck's pictures (through the editor's own way of keeping a picture, never from here), so a slide, a PDF, a PowerPoint file and
//! a show with no network all have the video's face. Nothing is written here.
//!
//! Only two kinds of address are fetched, and only exactly: an address a deck names is never fetched as it is. The editor says which site
//! and the address its picture is at; this checks that it is that site's thumbnail address, nothing else, before a request is made.

use std::time::Duration;

use reqwest::Url;
use reqwest::header::ACCEPT;
use serde::Serialize;
use tauri::State;

use crate::chat::commands::ChatState;

/// A thumbnail is a few tens of kilobytes; this is the most one may be.
const MAX_PICTURE: usize = 1024 * 1024;
/// The oEmbed answer of a video is a small piece of JSON.
const MAX_ANSWER: usize = 128 * 1024;
const WAIT: Duration = Duration::from_secs(15);

/// A picture fetched: its kind of file and its bytes.
#[derive(Debug, Serialize)]
pub struct Poster {
    pub ext: &'static str,
    pub bytes: Vec<u8>,
}

/// What an address the editor named is, once checked.
#[derive(Debug, PartialEq, Eq)]
enum Source {
    /// The picture itself.
    Picture(Url),
    /// Vimeo's answer to an oEmbed question, which names the picture.
    Answer(Url),
}

fn is_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A Vimeo video's address in an oEmbed question: `/<number>`, or `/<number>/<key>` for an unlisted one.
fn is_vimeo_video(path: &str) -> bool {
    let mut parts = path.trim_start_matches('/').split('/');
    let number = parts.next().unwrap_or("");
    let key = parts.next();
    parts.next().is_none()
        && !number.is_empty()
        && number.len() <= 12
        && number.chars().all(|c| c.is_ascii_digit())
        && key
            .is_none_or(|k| (8..=16).contains(&k.len()) && k.chars().all(|c| c.is_ascii_hexdigit()))
}

/// The address to fetch for a site and the address the editor named, or why it is refused.
fn source_of(provider: &str, address: &str) -> Result<Source, String> {
    let refused = || format!("“{address}” is not a thumbnail address of {provider}");
    let url = Url::parse(address).map_err(|_| refused())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return Err(refused());
    }
    match (provider, url.host_str()) {
        ("youtube", Some("img.youtube.com")) => {
            let mut parts = url.path().trim_start_matches('/').split('/');
            let ok = parts.next() == Some("vi")
                && parts.next().is_some_and(is_video_id)
                && parts.next() == Some("hqdefault.jpg")
                && parts.next().is_none()
                && url.query().is_none();
            ok.then_some(Source::Picture(url)).ok_or_else(refused)
        }
        ("vimeo", Some("vimeo.com")) => {
            let mut query = url.query_pairs();
            let asked = query.next();
            let ok = url.path() == "/api/oembed.json"
                && query.next().is_none()
                && asked.is_some_and(|(name, value)| {
                    name == "url"
                        && Url::parse(&value).is_ok_and(|video| {
                            video.scheme() == "https"
                                && video.host_str() == Some("vimeo.com")
                                && video.query().is_none()
                                && is_vimeo_video(video.path())
                        })
                });
            ok.then_some(Source::Answer(url)).ok_or_else(refused)
        }
        _ => Err(format!("KastenFlow fetches no pictures for “{provider}”")),
    }
}

/// The thumbnail address in a Vimeo oEmbed answer, when it is one on Vimeo's picture hosts over https.
fn vimeo_thumbnail(answer: &str) -> Option<Url> {
    let json: serde_json::Value = serde_json::from_str(answer).ok()?;
    let url = Url::parse(json.get("thumbnail_url")?.as_str()?).ok()?;
    let host = url.host_str()?;
    let on_vimeo = host == "vimeocdn.com" || host.ends_with(".vimeocdn.com");
    (url.scheme() == "https" && on_vimeo && url.username().is_empty() && url.password().is_none())
        .then_some(url)
}

/// The kind of picture the bytes are, by their first bytes: the three a thumbnail is. A header can say anything; the bytes cannot.
fn kind_of(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// The body of a response, read in pieces up to `most` bytes; None when it is bigger or the answer was not a success.
async fn body(client: &reqwest::Client, url: &Url, most: usize, accept: &str) -> Option<Vec<u8>> {
    let mut response = client
        .get(url.clone())
        .header(ACCEPT, accept)
        .timeout(WAIT)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > most as u64)
    {
        return None;
    }
    // What the site says the bytes are is not taken: `kind_of` looks at the bytes.
    let mut bytes = Vec::new();
    while let Some(piece) = response.chunk().await.ok()? {
        if bytes.len() + piece.len() > most {
            return None;
        }
        bytes.extend_from_slice(&piece);
    }
    Some(bytes)
}

/// Fetches the picture of a video: `provider` is `youtube` or `vimeo`, and `url` the address the editor made for it (YouTube's thumbnail,
/// or the oEmbed question for Vimeo). Resolves to None when the site has no picture for it.
#[tauri::command]
pub async fn fetch_poster(
    chat: State<'_, ChatState>,
    provider: String,
    url: String,
) -> Result<Option<Poster>, String> {
    let client = chat.web()?;
    let picture = match source_of(&provider, &url)? {
        Source::Picture(picture) => picture,
        Source::Answer(question) => {
            let Some(answer) = body(&client, &question, MAX_ANSWER, "application/json").await
            else {
                return Ok(None);
            };
            let Some(thumbnail) = vimeo_thumbnail(&String::from_utf8_lossy(&answer)) else {
                return Ok(None);
            };
            thumbnail
        }
    };
    let Some(bytes) = body(
        &client,
        &picture,
        MAX_PICTURE,
        "image/jpeg,image/png,image/webp",
    )
    .await
    else {
        return Ok(None);
    };
    Ok(kind_of(&bytes).map(|ext| Poster { ext, bytes }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const YT: &str = "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg";

    fn vimeo(video: &str) -> String {
        let mut url = Url::parse("https://vimeo.com/api/oembed.json").unwrap();
        url.query_pairs_mut().append_pair("url", video);
        url.to_string()
    }

    #[test]
    fn only_a_youtube_thumbnail_of_a_video_is_fetched_for_youtube() {
        assert!(matches!(source_of("youtube", YT), Ok(Source::Picture(_))));
        for bad in [
            "http://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
            "https://img.youtube.com/vi/short/hqdefault.jpg",
            "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg?x=1",
            "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg/extra",
            "https://img.youtube.com/vi/../hqdefault.jpg",
            "https://img.youtube.com:8443/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "https://user:pw@img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "https://img.youtube.com.evil.example/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "https://example.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "https://192.168.1.1/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "file:///etc/passwd",
            "not an address",
        ] {
            assert!(source_of("youtube", bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn only_vimeos_oembed_question_about_a_vimeo_video_is_asked_for_vimeo() {
        for good in [
            "https://vimeo.com/76979871",
            "https://vimeo.com/76979871/a1b2c3d4e5",
        ] {
            assert!(
                matches!(source_of("vimeo", &vimeo(good)), Ok(Source::Answer(_))),
                "{good}"
            );
        }
        for bad in [
            vimeo("https://vimeo.com/features"),
            vimeo("https://vimeo.com/76979871/x"),
            vimeo("https://vimeo.com/76979871/a1b2c3d4e5/more"),
            vimeo("https://example.com/76979871"),
            vimeo("http://vimeo.com/76979871"),
            vimeo("https://vimeo.com/76979871?x=1"),
            "https://vimeo.com/api/oembed.json".to_owned(),
            "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1&url=https%3A%2F%2Fvimeo.com%2F2".to_owned(),
            "https://vimeo.com/api/oembed.json?format=json".to_owned(),
            "https://vimeo.com/other.json?url=https%3A%2F%2Fvimeo.com%2F1".to_owned(),
            "https://evil.example/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1".to_owned(),
        ] {
            assert!(source_of("vimeo", &bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn another_site_or_a_site_with_the_other_ones_address_is_refused() {
        assert!(source_of("loom", YT).is_err());
        assert!(source_of("youtube", &vimeo("https://vimeo.com/1")).is_err());
        assert!(source_of("vimeo", YT).is_err());
        assert!(source_of("", YT).is_err());
    }

    #[test]
    fn the_thumbnail_of_an_oembed_answer_must_be_on_vimeos_picture_hosts_over_https() {
        let answer =
            |url: &str| format!(r#"{{"type":"video","title":"x","thumbnail_url":"{url}"}}"#);
        assert_eq!(
            vimeo_thumbnail(&answer("https://i.vimeocdn.com/video/1_640.jpg"))
                .map(|u| u.to_string()),
            Some("https://i.vimeocdn.com/video/1_640.jpg".to_owned())
        );
        for bad in [
            "http://i.vimeocdn.com/video/1.jpg",
            "https://vimeocdn.com.evil.example/1.jpg",
            "https://evilvimeocdn.com/1.jpg",
            "https://example.com/1.jpg",
            "https://127.0.0.1/1.jpg",
            "https://user:pw@i.vimeocdn.com/1.jpg",
            "file:///etc/passwd",
            "nonsense",
        ] {
            assert!(vimeo_thumbnail(&answer(bad)).is_none(), "{bad}");
        }
        assert!(vimeo_thumbnail("not json").is_none());
        assert!(vimeo_thumbnail(r#"{"type":"video"}"#).is_none());
        assert!(vimeo_thumbnail(r#"{"thumbnail_url":5}"#).is_none());
    }

    #[test]
    fn a_picture_is_what_its_bytes_say_whatever_the_header_said() {
        assert_eq!(kind_of(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]), Some("jpg"));
        assert_eq!(
            kind_of(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]),
            Some("png")
        );
        assert_eq!(kind_of(b"RIFF\x24\x00\x00\x00WEBPVP8 "), Some("webp"));
        for not in [
            &b"<html>sorry</html>"[..],
            b"GIF89a",
            b"",
            b"RIFF\0\0\0\0WAVEfmt ",
        ] {
            assert_eq!(kind_of(not), None);
        }
    }

    #[test]
    fn a_picture_is_said_to_the_window_with_its_kind_and_bytes() {
        let json = serde_json::to_value(Poster {
            ext: "jpg",
            bytes: vec![255, 216],
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "ext": "jpg", "bytes": [255, 216] })
        );
    }
}
