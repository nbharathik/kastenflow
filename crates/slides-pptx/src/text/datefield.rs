//! Today's date as a PowerPoint date field. PowerPoint offers a handful of formats, named
//! `datetime1` to `datetime8`; a format of the editor is written as the nearest of them, and the
//! field shows the day the file is opened.

/// The field type that is nearest to a format written with `yyyy`, `MMMM`, `MMM`, `MM`, `dd`, `d`
/// and `EEEE`.
pub fn field_type(format: &str) -> &'static str {
    let has = |part: &str| format.contains(part);
    if has("EEEE") {
        "datetime2"
    } else if has("MMMM") && has("d") && format.find('d') < format.find("MMMM") {
        "datetime3"
    } else if has("MMMM") && has("d") {
        "datetime4"
    } else if has("MMMM") {
        "datetime6"
    } else if has("MMM") {
        "datetime5"
    } else {
        "datetime1"
    }
}

#[cfg(test)]
mod tests {
    use super::field_type;

    #[test]
    fn a_format_is_the_nearest_field_powerpoint_has() {
        assert_eq!(field_type("d MMMM yyyy"), "datetime3");
        assert_eq!(field_type("MMMM d, yyyy"), "datetime4");
        assert_eq!(field_type("EEEE, MMMM d, yyyy"), "datetime2");
        assert_eq!(field_type("MMMM yyyy"), "datetime6");
        assert_eq!(field_type("d-MMM-yy"), "datetime5");
        assert_eq!(field_type("yyyy-MM-dd"), "datetime1");
    }
}
