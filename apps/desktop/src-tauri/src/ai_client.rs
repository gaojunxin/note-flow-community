//! Client-owned AI credentials and HTTP. Keys never cross back into the webview.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());

fn entry(scope: &str, endpoint: &str) -> Result<keyring::Entry, String> {
    if scope.is_empty() || scope.len() > 512 { return Err("AI 空间标识无效".into()); }
    let identity = format!("{:x}", Sha256::digest(format!("{scope}\n{endpoint}")));
    keyring::Entry::new("com.noteflow.ai", &identity).map_err(|_| "系统安全凭据服务不可用".into())
}
fn endpoint_url(endpoint: &str, allow_insecure_http: bool) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| "模型接口地址无效")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && (local || allow_insecure_http)))
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("非本机 HTTP 接口需要先确认允许明文传输".into());
    }
    Ok(url)
}
fn provider_error(status:u16, body:&[u8])->String {
 let value:serde_json::Value=serde_json::from_slice(body).unwrap_or_default();
 let text=["message","code","param","type"].iter().filter_map(|field|value.get("error")?.get(*field)?.as_str()).collect::<Vec<_>>().join(" ").to_lowercase();
 let hint=if status!=400 {""} else if text.contains("reasoning_content") {"思考上下文缺失"} else if text.contains("model") {"模型 ID 无效"} else if text.contains("context")||text.contains("token")||text.contains("length") {"上下文超出限制"} else if text.contains("messages")||text.contains("role")||text.contains("content") {"消息格式无效"} else if text.contains("stream") {"流式参数不兼容"} else {""};
 format!("模型调用失败（HTTP {}）{}{}",status,if hint.is_empty(){""}else{"；"},hint)
}
async fn response_error(response:&mut reqwest::Response)->String {
 let status=response.status().as_u16();let mut body=Vec::new();
 while let Ok(Some(chunk))=response.chunk().await {if body.len()+chunk.len()>16384{break}body.extend_from_slice(&chunk);}
 provider_error(status,&body)
}

#[tauri::command]
pub fn ai_store_key(scope: String, endpoint: String, key: Option<String>, allow_insecure_http: Option<bool>) -> Result<(), String> {
    endpoint_url(&endpoint, allow_insecure_http.unwrap_or(false))?;
    let _guard = CREDENTIAL_LOCK.lock().map_err(|_| "安全凭据服务繁忙")?;
    let credential = entry(&scope, &endpoint)?;
    match key {
        Some(key) if !key.trim().is_empty() && key.len() <= 8192 => credential.set_password(&key).map_err(|_| "无法保存到系统安全凭据；未保存明文".into()),
        None => match credential.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err("无法删除系统安全凭据".into()) },
        _ => Err("API Key 无效".into()),
    }
}
#[derive(Deserialize)]
pub struct CompletionRequest { scope: String, endpoint: String, model: String, messages: Vec<Message>, #[serde(rename="requireKey")] require_key: bool, #[serde(default)] thinking:bool, #[serde(default, rename="allowInsecureHttp")] allow_insecure_http:bool }
#[derive(Deserialize, serde::Serialize)]
pub struct Message { role: String, content: String }
#[tauri::command]
pub async fn ai_direct_completion(request: CompletionRequest) -> Result<String, String> {
    endpoint_url(&request.endpoint, request.allow_insecure_http)?;
    if request.model.trim().is_empty() || request.model.len() > 200 || request.messages.is_empty()
        || request.messages.len() > 24 || request.messages.iter().map(|m|m.content.len()).sum::<usize>() > 100_000
        || request.messages.iter().any(|m| !matches!(m.role.as_str(), "user" | "assistant" | "system")) {
        return Err("模型请求超出限制".into());
    }
    let key = if request.require_key {
        let _guard = CREDENTIAL_LOCK.lock().map_err(|_| "安全凭据服务繁忙")?;
        Some(entry(&request.scope, &request.endpoint)?.get_password().map_err(|_| "请重新保存个人 API Key；系统凭据不可用或未配置")?)
    } else { None };
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(120)).build().map_err(|_| "无法初始化模型连接")?;
    let mut call = client.post(format!("{}/chat/completions", request.endpoint.trim_end_matches('/')))
        .json(&serde_json::json!({"model":request.model,"messages":request.messages,"stream":false}));
    if let Some(key) = key { call = call.bearer_auth(key); }
    let mut response = call.send().await.map_err(|_| "模型服务连接失败或超时，请确认模型已启动")?;
    if !response.status().is_success() { return Err(response_error(&mut response).await); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "模型响应中断")? {
        if bytes.len() + chunk.len() > 2_000_000 { return Err("模型响应超过限制".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "模型返回格式无效")?;
    value.pointer("/choices/0/message/content").and_then(|v|v.as_str()).filter(|v|!v.trim().is_empty())
        .map(String::from).ok_or_else(|| "模型未返回文本回答".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn endpoint_policy() {
        for value in ["http://10.0.0.20:8000/v1", "http://models.lan:8080/v1"] { assert!(endpoint_url(value, true).is_ok()); assert!(endpoint_url(value, false).is_err()); }
        assert!(endpoint_url("http://user:key@models.lan/v1", true).is_err());
        for value in ["http://localhost:11434/v1", "http://127.0.0.1:11434/v1", "http://[::1]:11434/v1", "https://models.example/v1"] { assert!(endpoint_url(value, false).is_ok()); }
        for value in ["http://models.example/v1", "https://user:key@models.example/v1", "file:///tmp/model", "https://models.example/v1?key=secret"] { assert!(endpoint_url(value, false).is_err()); }
    }
}

// Request-scoped cancellation is restricted to the originating webview.
static STREAMS: std::sync::OnceLock<Mutex<std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>>> = std::sync::OnceLock::new();
fn streams() -> &'static Mutex<std::collections::HashMap<String,tokio::sync::watch::Sender<bool>>> {STREAMS.get_or_init(||Mutex::new(std::collections::HashMap::new()))}
#[tauri::command]
pub fn ai_cancel_completion(window:tauri::WebviewWindow,request_uid:String)->Result<(),String>{
 let key=format!("{}:{}",window.label(),request_uid);
 if let Some(cancel)=streams().lock().map_err(|_|"模型请求状态不可用")?.get(&key){let _=cancel.send(true);}Ok(())
}
#[tauri::command]
pub async fn ai_stream_completion(window:tauri::WebviewWindow,request_uid:String,request:CompletionRequest,chunks:tauri::ipc::Channel<Vec<u8>>)->Result<(),String>{
 endpoint_url(&request.endpoint, request.allow_insecure_http)?;
 if request_uid.is_empty()||request_uid.len()>64||request.model.trim().is_empty()||request.model.len()>200||request.messages.is_empty()||request.messages.len()>24||request.messages.iter().map(|m|m.content.len()).sum::<usize>()>100_000||request.messages.iter().any(|m|!matches!(m.role.as_str(),"user"|"assistant"|"system")){return Err("模型请求超出限制".into());}
 let credential=if request.require_key{Some(entry(&request.scope,&request.endpoint)?.get_password().map_err(|_|"请重新保存个人 API Key")?)}else{None};
 let key=format!("{}:{}",window.label(),request_uid);let (cancel,mut cancelled)=tokio::sync::watch::channel(false);
 {let mut active=streams().lock().map_err(|_|"模型请求状态不可用")?;if active.len()>=16||active.contains_key(&key){return Err("模型请求已存在或过多".into());}active.insert(key.clone(),cancel);}
 let result=async{
  let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(120)).build().map_err(|_|"无法初始化模型连接")?;
  let mut payload=serde_json::json!({"model":request.model,"messages":request.messages,"stream":true});
  if reqwest::Url::parse(&request.endpoint).ok().and_then(|url|url.host_str().map(str::to_owned)).as_deref()==Some("api.deepseek.com"){payload["thinking"]=serde_json::json!({"type":if request.thinking{"enabled"}else{"disabled"}});}
  let mut call=client.post(format!("{}/chat/completions",request.endpoint.trim_end_matches('/'))).json(&payload);
  if let Some(secret)=credential{call=call.bearer_auth(secret);}
  let mut response=tokio::select!{_ = cancelled.changed()=>return Err("已停止生成".to_string()),value=call.send()=>value.map_err(|_|"模型服务连接失败或超时")?};
  if !response.status().is_success(){return Err(tokio::select!{_ = cancelled.changed()=>"已停止生成".to_string(),value=response_error(&mut response)=>value});}
  let streaming=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).unwrap_or("").contains("text/event-stream");
  let metadata=format!("event: noteflow-transport\ndata: {}\n\n",serde_json::json!({"buffered":!streaming}));
  chunks.send(metadata.into_bytes()).map_err(|_|"回答窗口已关闭")?;
  let mut total=0;let mut buffered=Vec::new();
  loop{let next=tokio::select!{_ = cancelled.changed()=>return Err("已停止生成".to_string()),value=response.chunk()=>value.map_err(|_|"模型响应中断")?};let Some(bytes)=next else{break};total+=bytes.len();if total>2_000_000{return Err("模型响应超过限制".into());}if streaming{chunks.send(bytes.to_vec()).map_err(|_|"回答窗口已关闭")?;}else{buffered.extend_from_slice(&bytes);}}
  if !streaming{let value:serde_json::Value=serde_json::from_slice(&buffered).map_err(|_|"模型返回格式无效")?;let text=value.pointer("/choices/0/message/content").and_then(|v|v.as_str()).filter(|v|!v.trim().is_empty()).ok_or("模型未返回文本回答")?;if text.chars().count()>50000{return Err("模型回答超过限制".into());}let frame=format!("data: {}\n\ndata: [DONE]\n\n",serde_json::json!({"choices":[{"delta":{"content":text},"finish_reason":"stop"}]}));chunks.send(frame.into_bytes()).map_err(|_|"回答窗口已关闭")?;}
  chunks.send(Vec::new()).map_err(|_|"回答窗口已关闭")?;Ok(())
 }.await;
 if let Ok(mut active)=streams().lock(){active.remove(&key);}result
}

#[cfg(test)]
mod provider_error_tests {
 #[test] fn classifies_without_echoing_secrets(){
  let message=super::provider_error(400,br#"{"error":{"message":"Model Not Exist sk-secret"}}"#);
  assert!(message.contains("模型 ID 无效"));assert!(!message.contains("sk-secret"));
  assert_eq!(super::provider_error(400,b"unknown private body"),"模型调用失败（HTTP 400）");
 }
}
