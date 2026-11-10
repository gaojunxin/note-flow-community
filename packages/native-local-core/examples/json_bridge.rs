//! Local protocol harness for cross-language tests. Production shells bind paths themselves.
use note_flow_local_core::{LocalRequest, LocalStore};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| ":memory:".into());
    let mut store = LocalStore::open(path).expect("Cannot open isolated local test database");
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(input) => {
                let id = input.get("id").cloned().unwrap_or(Value::Null);
                match serde_json::from_value::<LocalRequest>(input) {
                    Ok(request) => match store.request(request) {
                        Ok(result) => json!({"id":id,"result":result}),
                        Err(error) => json!({"id":id,"error":{"code":error.code()}}),
                    },
                    Err(_) => json!({"id":id,"error":{"code":"INVALID_CHANGE"}}),
                }
            }
            Err(_) => json!({"id":null,"error":{"code":"INVALID_CHANGE"}}),
        };
        writeln!(stdout, "{response}").expect("Cannot write local test response");
        stdout.flush().expect("Cannot flush local test response");
    }
}
