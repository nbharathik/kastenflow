//! The list of functions the schema editor shows is the core's: a function
//! added to the core without the editor's help (or the reverse) fails here or
//! in the app's own test, which both read `fixtures/table-wire/formula-functions.json`.

use std::fs;
use std::path::Path;

use kasten_core::tags::formula::{FUNCTIONS, Formula};
use serde_json::Value;

#[test]
fn the_editors_function_list_is_the_cores_and_every_example_parses() {
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/table-wire/formula-functions.json");
    let json: Value = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
    let listed: Vec<(&str, u64)> = json["functions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| (f["name"].as_str().unwrap(), f["arity"].as_u64().unwrap()))
        .collect();
    let core: Vec<(&str, u64)> = FUNCTIONS.iter().map(|(n, a)| (*n, *a as u64)).collect();
    assert_eq!(
        listed, core,
        "the fixture must list exactly the core's functions"
    );
    for f in json["functions"].as_array().unwrap() {
        let example = f["example"].as_str().unwrap();
        assert!(
            example.starts_with(f["name"].as_str().unwrap()),
            "{example}"
        );
        Formula::parse(example).unwrap_or_else(|e| panic!("{example}: {e}"));
    }
}
