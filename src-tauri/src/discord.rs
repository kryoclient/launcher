//! Discord Rich Presence over the desktop client's local IPC socket.
//!
//! The webview cannot do this itself: Discord's local WebSocket RPC server
//! (port 6463) only accepts whitelisted browser origins. Games talk to the
//! client over `discord-ipc-N` instead — a named pipe on Windows, a unix
//! socket elsewhere — so the addon API forwards activities here.

use serde::Serialize;
use serde_json::{json, Value};
use std::io;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, watch};

/// Application ID of the "KryoClient" app in the Discord Developer Portal.
pub const CLIENT_ID: &str = "1551380521727164436";

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

const MAX_FRAME_LEN: u32 = 1 << 20;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const RETRY_DELAY: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    /// Nobody has asked for a presence, so there is no connection.
    Idle,
    Connecting,
    Connected,
    /// Discord is not running or refused the connection; retried periodically.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiscordStatus {
    pub state: ConnectionState,
    /// Display name of the Discord account the client is logged into.
    pub user: Option<String>,
    pub error: Option<String>,
}

impl DiscordStatus {
    fn new(state: ConnectionState) -> Self {
        Self {
            state,
            user: None,
            error: None,
        }
    }
}

pub struct DiscordPresence {
    activity: watch::Sender<Option<Value>>,
    status: watch::Receiver<DiscordStatus>,
}

impl DiscordPresence {
    pub fn spawn(app: AppHandle) -> Self {
        let (activity_tx, activity_rx) = watch::channel(None);
        let (status_tx, status_rx) = watch::channel(DiscordStatus::new(ConnectionState::Idle));
        tauri::async_runtime::spawn(run(app, activity_rx, status_tx));
        Self {
            activity: activity_tx,
            status: status_rx,
        }
    }
}

trait IpcStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> IpcStream for T {}

fn publish(app: &AppHandle, status_tx: &watch::Sender<DiscordStatus>, status: DiscordStatus) {
    let changed = *status_tx.borrow() != status;
    if changed {
        let _ = app.emit("discord-status", &status);
        status_tx.send_replace(status);
    }
}

async fn run(
    app: AppHandle,
    mut activity_rx: watch::Receiver<Option<Value>>,
    status_tx: watch::Sender<DiscordStatus>,
) {
    loop {
        // Stay disconnected until an addon wants a presence shown.
        while activity_rx.borrow_and_update().is_none() {
            publish(&app, &status_tx, DiscordStatus::new(ConnectionState::Idle));
            if activity_rx.changed().await.is_err() {
                return;
            }
        }

        publish(&app, &status_tx, DiscordStatus::new(ConnectionState::Connecting));

        let error = match connect().await {
            Ok((stream, user)) => {
                publish(
                    &app,
                    &status_tx,
                    DiscordStatus {
                        state: ConnectionState::Connected,
                        user: user.clone(),
                        error: None,
                    },
                );
                match session(stream, user, &mut activity_rx, &app, &status_tx).await {
                    // The activity was cleared; go back to idle without a retry delay.
                    Ok(()) => continue,
                    Err(e) => e,
                }
            }
            Err(e) => e,
        };

        publish(
            &app,
            &status_tx,
            DiscordStatus {
                state: ConnectionState::Unavailable,
                user: None,
                error: Some(error),
            },
        );

        // Discord may start later; retry, but react at once if the activity is cleared.
        tokio::select! {
            _ = tokio::time::sleep(RETRY_DELAY) => {}
            changed = activity_rx.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
    }
}

async fn connect() -> Result<(Box<dyn IpcStream>, Option<String>), String> {
    let mut stream = open_socket()
        .await
        .map_err(|_| "Discord не запущен".to_string())?;

    write_frame(&mut stream, OP_HANDSHAKE, &json!({ "v": 1, "client_id": CLIENT_ID }))
        .await
        .map_err(|e| format!("Ошибка подключения к Discord: {e}"))?;

    let (op, frame) = tokio::time::timeout(HANDSHAKE_TIMEOUT, read_frame(&mut stream))
        .await
        .map_err(|_| "Discord не ответил на подключение".to_string())?
        .map_err(|e| format!("Ошибка подключения к Discord: {e}"))?;

    if op == OP_CLOSE || frame["evt"] != "READY" {
        return Err(format!("Discord отклонил подключение: {}", frame_message(&frame)));
    }

    let user = &frame["data"]["user"];
    let name = user["global_name"]
        .as_str()
        .or_else(|| user["username"].as_str())
        .map(str::to_string);

    Ok((stream, name))
}

/// Runs one connection until the activity is cleared (`Ok`) or the pipe breaks (`Err`).
async fn session(
    stream: Box<dyn IpcStream>,
    user: Option<String>,
    activity_rx: &mut watch::Receiver<Option<Value>>,
    app: &AppHandle,
    status_tx: &watch::Sender<DiscordStatus>,
) -> Result<(), String> {
    let (mut reader, mut writer) = tokio::io::split(stream);

    // read_exact is not cancel-safe, so frames are read on their own task.
    let (frame_tx, mut frame_rx) = mpsc::channel::<(u32, Value)>(16);
    let reader_task = tokio::spawn(async move {
        while let Ok(frame) = read_frame(&mut reader).await {
            if frame_tx.send(frame).await.is_err() {
                break;
            }
        }
    });

    let result = pump(&mut writer, &mut frame_rx, activity_rx, &user, app, status_tx).await;
    reader_task.abort();
    result
}

async fn pump<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame_rx: &mut mpsc::Receiver<(u32, Value)>,
    activity_rx: &mut watch::Receiver<Option<Value>>,
    user: &Option<String>,
    app: &AppHandle,
    status_tx: &watch::Sender<DiscordStatus>,
) -> Result<(), String> {
    let mut nonce = 0u64;
    let initial = activity_rx.borrow_and_update().clone();
    send_activity(writer, initial, &mut nonce).await?;

    loop {
        tokio::select! {
            changed = activity_rx.changed() => {
                if changed.is_err() {
                    return Ok(());
                }
                let activity = activity_rx.borrow_and_update().clone();
                let cleared = activity.is_none();
                send_activity(writer, activity, &mut nonce).await?;
                if cleared {
                    return Ok(());
                }
            }
            frame = frame_rx.recv() => match frame {
                Some((OP_PING, payload)) => {
                    write_frame(writer, OP_PONG, &payload)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                Some((OP_CLOSE, payload)) => {
                    return Err(format!("Discord закрыл соединение: {}", frame_message(&payload)));
                }
                Some((_, payload)) if payload["cmd"] == "SET_ACTIVITY" => {
                    // Invalid activities are rejected per command, not by closing the pipe.
                    let error = (payload["evt"] == "ERROR")
                        .then(|| format!("Discord отклонил статус: {}", frame_message(&payload)));
                    let status = DiscordStatus {
                        state: ConnectionState::Connected,
                        user: user.clone(),
                        error,
                    };
                    publish(app, status_tx, status);
                }
                Some(_) => {}
                None => return Err("Discord закрыл соединение".to_string()),
            },
        }
    }
}

async fn send_activity<W: AsyncWrite + Unpin>(
    writer: &mut W,
    activity: Option<Value>,
    nonce: &mut u64,
) -> Result<(), String> {
    *nonce += 1;
    // Discord drops the activity once this process exits; omitting it clears it now.
    let mut args = json!({ "pid": std::process::id() });
    if let Some(activity) = activity {
        args["activity"] = activity;
    }
    write_frame(
        writer,
        OP_FRAME,
        &json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": nonce.to_string() }),
    )
    .await
    .map_err(|e| e.to_string())
}

fn frame_message(frame: &Value) -> String {
    frame["data"]["message"]
        .as_str()
        .or_else(|| frame["message"].as_str())
        .unwrap_or("неизвестная ошибка")
        .to_string()
}

async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    op: u32,
    payload: &Value,
) -> io::Result<()> {
    let body = serde_json::to_vec(payload)?;
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    writer.write_all(&buf).await?;
    writer.flush().await
}

async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<(u32, Value)> {
    let mut header = [0u8; 8];
    reader.read_exact(&mut header).await?;
    let op = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    if len > MAX_FRAME_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Discord sent an oversized frame",
        ));
    }
    let mut body = vec![0u8; len as usize];
    reader.read_exact(&mut body).await?;
    Ok((op, serde_json::from_slice(&body)?))
}

#[cfg(windows)]
async fn open_socket() -> io::Result<Box<dyn IpcStream>> {
    use tokio::net::windows::named_pipe::ClientOptions;

    let mut last_err = io::Error::from(io::ErrorKind::NotFound);
    for i in 0..10 {
        match ClientOptions::new().open(format!(r"\\.\pipe\discord-ipc-{i}")) {
            Ok(pipe) => return Ok(Box::new(pipe)),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

#[cfg(unix)]
async fn open_socket() -> io::Result<Box<dyn IpcStream>> {
    use std::path::PathBuf;
    use tokio::net::UnixStream;

    let mut dirs: Vec<PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
        .iter()
        .filter_map(|var| std::env::var_os(var))
        .map(PathBuf::from)
        .collect();
    dirs.push(PathBuf::from("/tmp"));

    // Flatpak and Snap builds of Discord put the socket in a subdirectory.
    let subdirs = ["", "app/com.discordapp.Discord", "snap.discord"];

    let mut last_err = io::Error::from(io::ErrorKind::NotFound);
    for dir in &dirs {
        for sub in subdirs {
            for i in 0..10 {
                let path = dir.join(sub).join(format!("discord-ipc-{i}"));
                match UnixStream::connect(&path).await {
                    Ok(stream) => return Ok(Box::new(stream)),
                    Err(e) => last_err = e,
                }
            }
        }
    }
    Err(last_err)
}

#[tauri::command]
pub fn discord_set_activity(
    activity: Value,
    presence: State<'_, DiscordPresence>,
) -> Result<(), String> {
    if !activity.is_object() {
        return Err("activity must be an object".to_string());
    }
    presence.activity.send_replace(Some(activity));
    Ok(())
}

#[tauri::command]
pub fn discord_clear_activity(presence: State<'_, DiscordPresence>) {
    presence.activity.send_replace(None);
}

#[tauri::command]
pub fn discord_get_status(presence: State<'_, DiscordPresence>) -> DiscordStatus {
    presence.status.borrow().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frames_round_trip() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        let payload = json!({ "cmd": "SET_ACTIVITY", "nonce": "1" });
        write_frame(&mut client, OP_FRAME, &payload).await.unwrap();
        let (op, value) = read_frame(&mut server).await.unwrap();
        assert_eq!(op, OP_FRAME);
        assert_eq!(value, payload);
    }

    #[tokio::test]
    async fn oversized_frame_is_rejected() {
        let (mut client, mut server) = tokio::io::duplex(64);
        let mut header = Vec::new();
        header.extend_from_slice(&OP_FRAME.to_le_bytes());
        header.extend_from_slice(&(MAX_FRAME_LEN + 1).to_le_bytes());
        client.write_all(&header).await.unwrap();
        assert!(read_frame(&mut server).await.is_err());
    }
}
