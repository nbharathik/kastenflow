//! Swapping the picture of an image element for another.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::util::{element_mut, slide_mut};
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::model::{Deck, Element};

op_types! {
    /// Puts another picture in an image element.
    pub struct ReplacePicture {
        pub slide: String,
        /// The image element's id.
        pub id: String,
        /// The new picture, a file already in the host's image store such as `assets/figure.png`.
        pub src: String,
    }
}

impl Op for ReplacePicture {
    type Output = ();
    const NAME: &'static str = "replace_picture";
    const ABOUT: &'static str = "Replace the picture of an image element with another from the image store. The element keeps its box, rotation, crop, mask, adjustments, link and alt text, so the new picture sits where the old one was; only the file changes.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        if self.src.trim().is_empty() {
            return Err(Error::bad_input(Self::NAME, "`src` names the new picture"));
        }
        let slide = slide_mut(cx.deck, &self.slide)?;
        match element_mut(slide, &self.id)? {
            Element::Image(image) => {
                image.src = self.src;
                Ok(())
            }
            other => Err(Error::refused(format!(
                "`{}` is a {} element, not a picture, so its picture cannot be replaced.",
                self.id,
                other.kind()
            ))),
        }
    }
}
