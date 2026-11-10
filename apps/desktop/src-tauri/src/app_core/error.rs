use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CoreErrorCode {
    InvalidArgument,
    ProfileNotFound,
    NotFound,
    Conflict,
    Unauthorized,
    Busy,
    Cancelled,
    Io,
    Database,
    Network,
    Internal,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub code: CoreErrorCode,
    pub message: String,
    pub retryable: bool,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl CoreError {
    pub fn new(
        code: CoreErrorCode,
        message: impl Into<String>,
        retryable: bool,
        request_id: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            request_id: request_id.into(),
            details: None,
        }
    }

    pub fn invalid(request_id: &str, message: impl Into<String>) -> Self {
        Self::new(CoreErrorCode::InvalidArgument, message, false, request_id)
    }
}
