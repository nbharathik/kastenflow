//! Sound on a slide, and the fonts a deck carries with it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Base, Extra, is_false};

model! {
    /// An audio file the host holds. In a show it plays by itself or on a click and can go on
    /// over several slides; everywhere else it is drawn as a small speaker chip.
    #[serde(rename_all = "camelCase")]
    pub struct AudioEl {
        #[serde(flatten)]
        pub base: Base,
        /// A file in the host's store (`assets/...`) or a web address (`http` or `https`) of an audio file.
        pub src: String,
        /// Words set under the chip, such as the title of the piece; the file's name when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub label: Option<String>,
        /// Starts when the slide shows; otherwise a click on the chip starts it.
        #[serde(default, skip_serializing_if = "is_false")]
        pub autoplay: bool,
        /// Starts again after its end.
        #[serde(default, skip_serializing_if = "is_false")]
        pub looped: bool,
        /// How many slides, this one included, it keeps playing over. One when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub across: Option<u32>,
        /// The chip is not drawn in the show (it still is in the editor).
        #[serde(default, skip_serializing_if = "is_false")]
        pub hidden: bool,
        /// 0 (silent) to 1 (as recorded); 1 when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub volume: Option<f64>,
        /// Seconds into the file where it starts.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub start: Option<f64>,
        /// Seconds into the file where it stops.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub end: Option<f64>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A font file the deck carries, so it looks the same on a machine that lacks the font.
    #[serde(rename_all = "camelCase")]
    pub struct DeckFont {
        /// The family name text uses (`Run::font`).
        pub family: String,
        /// A file in the host's store, such as `assets/fonts/Name.woff2`.
        pub src: String,
        /// `true` bold, `false` regular: the weight this file is for.
        #[serde(default, skip_serializing_if = "is_false")]
        pub bold: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        pub italic: bool,
        /// The licence lets the font travel inside an exported file. Off when absent: a font is never embedded unless the person says so.
        #[serde(default, skip_serializing_if = "is_false")]
        pub embeddable: bool,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

/// The least and most a volume can be.
pub fn clamp_volume(volume: f64) -> f64 {
    if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        1.0
    }
}

impl AudioEl {
    /// The volume it plays at, in 0 to 1.
    pub fn level(&self) -> f64 {
        self.volume.map_or(1.0, clamp_volume)
    }

    /// How many slides it plays over: at least one.
    pub fn slides(&self) -> u32 {
        self.across.unwrap_or(1).clamp(1, 999)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Element;

    #[test]
    fn an_audio_reads_and_writes_back_the_same_and_keeps_unknown_fields() {
        let old = serde_json::json!({
            "type": "audio", "id": "a-1", "x": 10.0, "y": 10.0, "w": 120.0, "h": 120.0,
            "src": "assets/theme.mp3", "autoplay": true, "across": 3, "hidden": true,
            "volume": 0.5, "futureField": [1, 2],
        });
        let Element::Audio(el) = serde_json::from_value(old.clone()).expect("an audio") else {
            panic!("an audio")
        };
        assert_eq!((el.slides(), el.level()), (3, 0.5));
        assert!(el.autoplay && el.hidden && !el.looped);
        assert_eq!(serde_json::to_value(Element::Audio(el)).expect("json"), old);
    }

    #[test]
    fn defaults_are_one_slide_and_full_volume_and_nothing_extra_is_written() {
        let bare = serde_json::json!({
            "type": "audio", "id": "a-2", "x": 0.0, "y": 0.0, "w": 80.0, "h": 80.0,
            "src": "https://example.com/a.mp3",
        });
        let Element::Audio(el) = serde_json::from_value(bare.clone()).expect("an audio") else {
            panic!("an audio")
        };
        assert_eq!((el.slides(), el.level()), (1, 1.0));
        assert_eq!(
            serde_json::to_value(Element::Audio(el)).expect("json"),
            bare
        );
    }

    #[test]
    fn odd_numbers_are_kept_inside_their_range() {
        assert_eq!(clamp_volume(3.0), 1.0);
        assert_eq!(clamp_volume(-1.0), 0.0);
        assert_eq!(clamp_volume(f64::NAN), 1.0);
        let mut el = AudioEl {
            base: Base::new("a"),
            src: String::new(),
            label: None,
            autoplay: false,
            looped: false,
            across: Some(0),
            hidden: false,
            volume: Some(9.0),
            start: None,
            end: None,
            extra: Extra::new(),
        };
        assert_eq!((el.slides(), el.level()), (1, 1.0));
        el.across = Some(u32::MAX);
        assert_eq!(el.slides(), 999);
    }

    #[test]
    fn a_deck_font_is_not_embeddable_unless_it_says_so() {
        let font: DeckFont = serde_json::from_value(serde_json::json!({
            "family": "Inter", "src": "assets/fonts/Inter.woff2", "bold": true
        }))
        .expect("a font");
        assert!(!font.embeddable && font.bold && !font.italic);
        let back = serde_json::to_value(&font).expect("json");
        assert!(back.get("embeddable").is_none());
    }
}
