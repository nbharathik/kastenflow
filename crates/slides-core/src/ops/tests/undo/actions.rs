//! The things the property test does to a deck, and the strategy that picks them. An action names things by
//! number (a slide, an element, a layout), so it means something on whatever deck the run has reached; `plan.rs`
//! turns it into an operation, or into nothing when what it names is not there.

use proptest::prelude::*;

#[derive(Clone, Debug)]
pub(super) enum Action {
    AddSlide {
        layout: usize,
    },
    AddText {
        slide: usize,
        x: u16,
        y: u16,
    },
    Transform {
        slide: usize,
        el: usize,
        x: u16,
        y: u16,
        w: u16,
        turn: u8,
    },
    Delete {
        slide: usize,
        el: usize,
    },
    Duplicate {
        slide: usize,
        el: usize,
    },
    Group {
        slide: usize,
        a: usize,
        b: usize,
    },
    Ungroup {
        slide: usize,
        el: usize,
    },
    Reorder {
        slide: usize,
        el: usize,
        to: u8,
    },
    Align {
        slide: usize,
        a: usize,
        b: usize,
        mode: u8,
    },
    /// One element, aligned to the slide.
    AlignOne {
        slide: usize,
        el: usize,
        mode: u8,
    },
    SetText {
        slide: usize,
        el: usize,
        n: u8,
    },
    /// The look of the paragraphs of an element, without its words.
    FormatParagraphs {
        slide: usize,
        el: usize,
        n: u8,
    },
    Layout {
        slide: usize,
        layout: usize,
    },
    DeleteSlide {
        slide: usize,
    },
    DuplicateSlide {
        slide: usize,
    },
    MoveSlide {
        slide: usize,
        to: usize,
    },
    Flags {
        slide: usize,
        hidden: bool,
        backup: bool,
    },
    Theme {
        i: usize,
    },
    Notes {
        slide: usize,
        n: u8,
    },
    SetSteps {
        slide: usize,
        n: u8,
    },
    States {
        slide: usize,
        el: usize,
        step: u8,
        state: u8,
    },
    Build {
        slide: usize,
        a: usize,
        b: usize,
        recipe: u8,
    },
    AddComposite {
        slide: usize,
        kind: u8,
    },
    Expand {
        slide: usize,
        el: usize,
    },
    AddSection {
        slide: usize,
        n: u8,
    },
    RenameSection {
        slide: usize,
        n: u8,
    },
    RemoveSection {
        slide: usize,
    },
    Present {
        numbers: bool,
    },
    PageSize {
        n: u8,
    },
    DeckTransition {
        n: u8,
    },
    LayoutSave {
        slide: usize,
        el: usize,
        n: u8,
    },
    LayoutAdd {
        layout: usize,
        n: u8,
    },
    LayoutDesign {
        layout: usize,
        n: u8,
    },
    LayoutEdit {
        layout: usize,
        n: u8,
    },
    LayoutDelete {
        layout: usize,
    },
    LayoutMove {
        layout: usize,
        to: usize,
    },
    LayoutImport {
        layout: usize,
    },
    ResetSlide {
        slide: usize,
    },
    Template {
        n: u8,
        resize: bool,
    },
    /// The contents of a page, or a section of it, on a slide.
    PageContents {
        slide: usize,
        n: u8,
    },
    /// What came from a page, made again from the page as it reads now.
    PageUpdate {
        n: u8,
    },
    /// A page as slides.
    PageSlides {
        n: u8,
    },
    /// A page drafted as a storyboard and made into slides, after a slide or at the end.
    Storyboard {
        n: u8,
        after: bool,
    },
    /// A slide that came from a page, kept as it is when the page moved on.
    Acknowledge {
        n: u8,
    },
    /// A table of three by three with a merged corner, on a slide.
    TableAdd {
        slide: usize,
    },
    /// Words in a block of cells of the first table on a slide.
    CellsSet {
        slide: usize,
        n: u8,
    },
    CellsClear {
        slide: usize,
        a: u8,
        b: u8,
        c: u8,
        d: u8,
    },
    RowsInsert {
        slide: usize,
        at: u8,
        count: u8,
    },
    RowsDelete {
        slide: usize,
        from: u8,
        count: u8,
    },
    ColsInsert {
        slide: usize,
        at: u8,
        count: u8,
    },
    ColsDelete {
        slide: usize,
        from: u8,
        count: u8,
    },
    Merge {
        slide: usize,
        a: u8,
        b: u8,
        c: u8,
        d: u8,
    },
    Unmerge {
        slide: usize,
        a: u8,
        b: u8,
    },
    CellFill {
        slide: usize,
        a: u8,
        b: u8,
        c: u8,
        d: u8,
        n: u8,
    },
    /// Words with marks (a highlight, or one that is not a colour; bold, colour, links, lists), set as an element's text.
    Highlight {
        slide: usize,
        el: usize,
        n: u8,
    },
    /// A slide of this deck pasted as if it came from a deck of another size.
    PasteSized {
        slide: usize,
        n: u8,
    },
    /// A layout imported as if it came from a deck of another size.
    LayoutImportSized {
        layout: usize,
        n: u8,
    },
    Replace,
    Undo,
    Redo,
}

pub(super) fn action() -> impl Strategy<Value = Action> {
    let idx = || 0usize..8;
    prop_oneof![
        idx().prop_map(|layout| Action::AddSlide { layout }),
        (idx(), 0u16..900, 0u16..500).prop_map(|(slide, x, y)| Action::AddText { slide, x, y }),
        (idx(), idx(), 0u16..900, 0u16..500, 1u16..400, 0u8..4).prop_map(
            |(slide, el, x, y, w, turn)| Action::Transform {
                slide,
                el,
                x,
                y,
                w,
                turn
            }
        ),
        (idx(), idx()).prop_map(|(slide, el)| Action::Delete { slide, el }),
        (idx(), idx()).prop_map(|(slide, el)| Action::Duplicate { slide, el }),
        (idx(), idx(), idx()).prop_map(|(slide, a, b)| Action::Group { slide, a, b }),
        (idx(), idx()).prop_map(|(slide, el)| Action::Ungroup { slide, el }),
        (idx(), idx(), 0u8..4).prop_map(|(slide, el, to)| Action::Reorder { slide, el, to }),
        (idx(), idx(), idx(), 0u8..6).prop_map(|(slide, a, b, mode)| Action::Align {
            slide,
            a,
            b,
            mode
        }),
        (idx(), idx(), 0u8..6).prop_map(|(slide, el, mode)| Action::AlignOne { slide, el, mode }),
        (idx(), idx(), 0u8..5).prop_map(|(slide, el, n)| Action::SetText { slide, el, n }),
        (idx(), idx(), 0u8..8).prop_map(|(slide, el, n)| Action::FormatParagraphs { slide, el, n }),
        (idx(), idx()).prop_map(|(slide, layout)| Action::Layout { slide, layout }),
        idx().prop_map(|slide| Action::DeleteSlide { slide }),
        idx().prop_map(|slide| Action::DuplicateSlide { slide }),
        (idx(), idx()).prop_map(|(slide, to)| Action::MoveSlide { slide, to }),
        (idx(), any::<bool>(), any::<bool>()).prop_map(|(slide, hidden, backup)| Action::Flags {
            slide,
            hidden,
            backup
        }),
        idx().prop_map(|i| Action::Theme { i }),
        (idx(), 0u8..3).prop_map(|(slide, n)| Action::Notes { slide, n }),
        (idx(), 0u8..8).prop_map(|(slide, n)| Action::SetSteps { slide, n }),
        (idx(), idx(), 0u8..7, 0u8..5).prop_map(|(slide, el, step, state)| Action::States {
            slide,
            el,
            step,
            state
        }),
        (idx(), idx(), idx(), 0u8..4).prop_map(|(slide, a, b, recipe)| Action::Build {
            slide,
            a,
            b,
            recipe
        }),
        (idx(), 0u8..12).prop_map(|(slide, kind)| Action::AddComposite { slide, kind }),
        (idx(), idx()).prop_map(|(slide, el)| Action::Expand { slide, el }),
        (idx(), 0u8..3).prop_map(|(slide, n)| Action::AddSection { slide, n }),
        (idx(), 0u8..3).prop_map(|(slide, n)| Action::RenameSection { slide, n }),
        idx().prop_map(|slide| Action::RemoveSection { slide }),
        any::<bool>().prop_map(|numbers| Action::Present { numbers }),
        (0u8..6).prop_map(|n| Action::PageSize { n }),
        (0u8..5).prop_map(|n| Action::DeckTransition { n }),
        (idx(), idx(), 0u8..3).prop_map(|(slide, el, n)| Action::LayoutSave { slide, el, n }),
        (idx(), 0u8..4).prop_map(|(layout, n)| Action::LayoutAdd { layout, n }),
        (idx(), 0u8..3).prop_map(|(layout, n)| Action::LayoutDesign { layout, n }),
        (idx(), 0u8..4).prop_map(|(layout, n)| Action::LayoutEdit { layout, n }),
        idx().prop_map(|layout| Action::LayoutDelete { layout }),
        (idx(), idx()).prop_map(|(layout, to)| Action::LayoutMove { layout, to }),
        idx().prop_map(|layout| Action::LayoutImport { layout }),
        idx().prop_map(|slide| Action::ResetSlide { slide }),
        (0u8..11, any::<bool>()).prop_map(|(n, resize)| Action::Template { n, resize }),
        (idx(), 0u8..5).prop_map(|(slide, n)| Action::PageContents { slide, n }),
        (0u8..5).prop_map(|n| Action::PageUpdate { n }),
        (0u8..5).prop_map(|n| Action::PageSlides { n }),
        (0u8..10, any::<bool>()).prop_map(|(n, after)| Action::Storyboard { n, after }),
        (0u8..5).prop_map(|n| Action::Acknowledge { n }),
        idx().prop_map(|slide| Action::TableAdd { slide }),
        (idx(), 0u8..14).prop_map(|(slide, n)| Action::CellsSet { slide, n }),
        (idx(), 0u8..5, 0u8..5, 0u8..5, 0u8..5)
            .prop_map(|(slide, a, b, c, d)| Action::CellsClear { slide, a, b, c, d }),
        (idx(), 0u8..6, 0u8..4).prop_map(|(slide, at, count)| Action::RowsInsert {
            slide,
            at,
            count
        }),
        (idx(), 0u8..6, 0u8..3).prop_map(|(slide, from, count)| Action::RowsDelete {
            slide,
            from,
            count
        }),
        (idx(), 0u8..6, 0u8..4).prop_map(|(slide, at, count)| Action::ColsInsert {
            slide,
            at,
            count
        }),
        (idx(), 0u8..6, 0u8..3).prop_map(|(slide, from, count)| Action::ColsDelete {
            slide,
            from,
            count
        }),
        (idx(), 0u8..5, 0u8..5, 0u8..5, 0u8..5).prop_map(|(slide, a, b, c, d)| Action::Merge {
            slide,
            a,
            b,
            c,
            d
        }),
        (idx(), 0u8..5, 0u8..5).prop_map(|(slide, a, b)| Action::Unmerge { slide, a, b }),
        (idx(), 0u8..5, 0u8..5, 0u8..5, 0u8..5, 0u8..3).prop_map(|(slide, a, b, c, d, n)| {
            Action::CellFill {
                slide,
                a,
                b,
                c,
                d,
                n,
            }
        }),
        (idx(), idx(), 0u8..8).prop_map(|(slide, el, n)| Action::Highlight { slide, el, n }),
        (idx(), 0u8..4).prop_map(|(slide, n)| Action::PasteSized { slide, n }),
        (idx(), 0u8..4).prop_map(|(layout, n)| Action::LayoutImportSized { layout, n }),
        Just(Action::Replace),
        Just(Action::Undo),
        Just(Action::Redo),
    ]
}
