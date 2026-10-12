//! The colours of each theme. The ten names are the ones a PPTX theme has,
//! so a deck exports and imports its palette without translation.

use crate::model::Colors;

fn colors(text1: &str, text2: &str, bg1: &str, bg2: &str, accents: [&str; 6]) -> Colors {
    let [accent1, accent2, accent3, accent4, accent5, accent6] = accents.map(str::to_owned);
    Colors {
        text1: text1.to_owned(),
        text2: text2.to_owned(),
        bg1: bg1.to_owned(),
        bg2: bg2.to_owned(),
        accent1,
        accent2,
        accent3,
        accent4,
        accent5,
        accent6,
        extra: crate::model::Extra::new(),
    }
}

/// White paper, dark grey ink, and the blue, red, yellow and green of Google's own slides.
pub(super) fn light() -> Colors {
    colors(
        "#202124",
        "#5f6368",
        "#ffffff",
        "#f1f3f4",
        [
            "#1a73e8", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6",
        ],
    )
}

/// Near-black paper. The accents are the light theme's, brightened so they keep
/// their contrast on a dark ground.
pub(super) fn dark() -> Colors {
    colors(
        "#f1f3f4",
        "#9aa0a6",
        "#0f1115",
        "#1b1f27",
        [
            "#8ab4f8", "#f28b82", "#fdd663", "#81c995", "#fcad70", "#78d9ec",
        ],
    )
}

/// Warm paper and brown ink, with muted accents that print well.
pub(super) fn serif() -> Colors {
    colors(
        "#2b2118",
        "#6b5d4d",
        "#fffdf8",
        "#f3efe6",
        [
            "#8c2f39", "#1f6f8b", "#c58b1b", "#3f7d4a", "#b5541b", "#5b4a8a",
        ],
    )
}

/// A university look: `bg2` is the grey of the header bar, and the main accent is a deep blue.
pub(super) fn lecture() -> Colors {
    colors(
        "#1f2933",
        "#52606d",
        "#ffffff",
        "#e6e8eb",
        [
            "#0b5cad", "#c0392b", "#d68910", "#1e8449", "#7d3c98", "#148f77",
        ],
    )
}

/// White paper, black ink and one vermilion accent; the others stay quiet.
pub(super) fn minimal() -> Colors {
    colors(
        "#111111",
        "#595959",
        "#ffffff",
        "#f3f3f1",
        [
            "#e4572e", "#2b6f77", "#e0a800", "#5f8f2f", "#6c5b7b", "#4a7fa0",
        ],
    )
}

/// Rose red and ink on white, with a cream second background that carries the red's warmth.
pub(super) fn bold() -> Colors {
    colors(
        "#0b0b0f",
        "#4b4b57",
        "#ffffff",
        "#fff1d6",
        [
            "#e11d48", "#0f172a", "#d97706", "#047857", "#6d28d9", "#0369a1",
        ],
    )
}

/// Slate ink on white with an indigo lead and a tinted second background.
pub(super) fn modern() -> Colors {
    colors(
        "#0f172a",
        "#475569",
        "#ffffff",
        "#eef2f7",
        [
            "#4f46e5", "#0284c7", "#d97706", "#059669", "#db2777", "#7c3aed",
        ],
    )
}

/// Cream paper, dark ink and a burgundy that reads as a printed journal.
pub(super) fn academic() -> Colors {
    colors(
        "#1f2430",
        "#57525c",
        "#fbf8f1",
        "#efe9da",
        [
            "#7a1f2b", "#1d4e6b", "#8f6a1f", "#3b6e4f", "#5b4a8a", "#8a5a44",
        ],
    )
}

/// Midnight blue paper and amber for the one thing to look at; the accents are bright enough
/// to hold their own on it.
pub(super) fn pitch() -> Colors {
    colors(
        "#f8fafc",
        "#aab6cc",
        "#0b1b3a",
        "#142a52",
        [
            "#ffb703", "#3ddc97", "#ff6b6b", "#4cc9f0", "#b794f6", "#f4a261",
        ],
    )
}

/// Near-black with a cyan that glows against it.
pub(super) fn dark_studio() -> Colors {
    colors(
        "#f4f4f5",
        "#a1a1aa",
        "#09090b",
        "#18181b",
        [
            "#22d3ee", "#a78bfa", "#fbbf24", "#34d399", "#fb7185", "#60a5fa",
        ],
    )
}

/// Warm paper, brown ink and terracotta, with earthy accents.
pub(super) fn warm_paper() -> Colors {
    colors(
        "#3a2e26",
        "#6b5a4c",
        "#f6efe0",
        "#eadfc8",
        [
            "#b8431f", "#5c7a4a", "#b8791a", "#2f6f73", "#7a3b5e", "#4f5d75",
        ],
    )
}
