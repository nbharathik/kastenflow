//! The editor's own colour swatches, by name. A token sets a fill and a
//! stroke that go together; neutral nodes set neither, so the editor's dark
//! mode can adapt them.

use crate::diagrams::model::Style;

#[derive(Debug, Clone, Copy)]
pub struct Swatch {
    pub name: &'static str,
    pub fill: &'static str,
    pub stroke: &'static str,
}

pub const SWATCHES: [Swatch; 7] = [
    Swatch {
        name: "blue",
        fill: "#dae8fc",
        stroke: "#6c8ebf",
    },
    Swatch {
        name: "green",
        fill: "#d5e8d4",
        stroke: "#82b366",
    },
    Swatch {
        name: "yellow",
        fill: "#fff2cc",
        stroke: "#d6b656",
    },
    Swatch {
        name: "orange",
        fill: "#ffe6cc",
        stroke: "#d79b00",
    },
    Swatch {
        name: "red",
        fill: "#f8cecc",
        stroke: "#b85450",
    },
    Swatch {
        name: "purple",
        fill: "#e1d5e7",
        stroke: "#9673a6",
    },
    Swatch {
        name: "grey",
        fill: "#f5f5f5",
        stroke: "#666666",
    },
];

pub fn swatch(name: &str) -> Option<&'static Swatch> {
    let name = name.trim().to_lowercase();
    let name = if name == "gray" {
        "grey"
    } else {
        name.as_str()
    };
    SWATCHES.iter().find(|s| s.name == name)
}

/// Colours `style` with the swatch `token`; an edge only gets its line colour.
pub fn apply_token(style: &mut Style, token: &str, edge: bool) -> Result<(), String> {
    let Some(s) = swatch(token) else {
        let names: Vec<&str> = SWATCHES.iter().map(|s| s.name).collect();
        return Err(format!(
            "No colour called “{token}”; the colours are {}",
            names.join(", ")
        ));
    };
    style.set("strokeColor", s.stroke);
    if !edge {
        style.set("fillColor", s.fill);
    }
    Ok(())
}
