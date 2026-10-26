//! The resources the server offers: reference text an agent reads when it
//! needs it, instead of carrying it in every conversation. Today one: the
//! smart kit, `kasten://smart/kit`.

use rmcp::model::{
    ErrorData, ReadResourceResponse, ReadResourceResult, Resource, ResourceContents,
};

use crate::smart_kit;

/// Every resource, as `resources/list` shows them.
pub(crate) fn listed() -> Vec<Resource> {
    vec![
        Resource::new(smart_kit::URI, smart_kit::NAME)
            .with_description(smart_kit::DESCRIPTION)
            .with_mime_type("text/markdown"),
    ]
}

/// A resource's text, or a plain error for an address that is not one.
pub(crate) fn read(uri: &str) -> Result<ReadResourceResponse, ErrorData> {
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
