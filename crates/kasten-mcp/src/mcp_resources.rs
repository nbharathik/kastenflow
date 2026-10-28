//! The resources the server offers: reference text an agent reads when it
//! needs it, instead of carrying it in every conversation. Today one: the
//! smart kit, `kasten://smart/kit`.

use rmcp::model::{
    ErrorData, ReadResourceResponse, ReadResourceResult, Resource, ResourceContents,
};

use crate::smart_kit;

/// Every resource, as `resources/list` shows them. The smart kit belongs to
/// the Smart pages plugin: it is offered only while `smart` pages are on.
pub(crate) fn listed(smart: bool) -> Vec<Resource> {
    if !smart {
        return Vec::new();
    }
    vec![
        Resource::new(smart_kit::URI, smart_kit::NAME)
            .with_description(smart_kit::DESCRIPTION)
            .with_mime_type("text/markdown"),
    ]
}

/// A resource's text, or a plain error for an address that is not one (or
/// whose plugin is off).
pub(crate) fn read(uri: &str, smart: bool) -> Result<ReadResourceResponse, ErrorData> {
    if uri == smart_kit::URI && !smart {
        return Err(ErrorData::resource_not_found(
            "Smart pages are off in this vault, so there is no smart kit. Ask the person with request_smart_pages",
            None,
        ));
    }
    if uri == smart_kit::URI {
        return Ok(ReadResourceResult::new(vec![
            ResourceContents::text(smart_kit::reference(), smart_kit::URI)
                .with_mime_type("text/markdown"),
        ])
        .into());
    }
    Err(ErrorData::resource_not_found(
        format!(
            "There is no resource {uri}. The one there is: {}",
            smart_kit::URI
        ),
        None,
    ))
}
