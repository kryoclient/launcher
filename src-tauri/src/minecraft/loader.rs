pub const FABRIC_FALLBACK: &str = "0.19.5";

const FABRIC_META_LOADERS: &str = "https://meta.fabricmc.net/v2/versions/loader";

const STALE_FABRIC_DEFAULTS: [&str; 2] = ["0.16.10", "0.19.3"];

pub fn is_stale_fabric_default(loader_version: &str) -> bool {
    STALE_FABRIC_DEFAULTS.contains(&loader_version)
}

fn pick_stable_version(entries: &[serde_json::Value]) -> Option<String> {
    entries
        .iter()
        .map(|entry| entry.get("loader").unwrap_or(entry))
        .find(|loader| loader.get("stable").and_then(|v| v.as_bool()) == Some(true))
        .and_then(|loader| loader.get("version").and_then(|v| v.as_str()))
        .map(|version| version.to_string())
}

async fn fetch_loaders(url: &str) -> Option<Vec<serde_json::Value>> {
    let client = crate::open_launcher::utils::get_http_client();

    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    response.json::<Vec<serde_json::Value>>().await.ok()
}

pub async fn latest_fabric_loader(game_version: &str) -> String {
    let per_game_version = format!("{}/{}", FABRIC_META_LOADERS, game_version);

    for url in [per_game_version.as_str(), FABRIC_META_LOADERS] {
        if let Some(entries) = fetch_loaders(url).await {
            if let Some(version) = pick_stable_version(&entries) {
                return version;
            }
        }
    }

    FABRIC_FALLBACK.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_stale_fabric_defaults_are_detected() {
        assert!(is_stale_fabric_default("0.16.10"));
        assert!(is_stale_fabric_default("0.19.3"));
        assert!(!is_stale_fabric_default(FABRIC_FALLBACK));
        assert!(!is_stale_fabric_default("47.2.0"));
    }

    #[test]
    fn test_pick_stable_version_skips_unstable_flat_entries() {
        let entries = vec![
            json!({ "version": "0.20.0", "stable": false }),
            json!({ "version": "0.19.5", "stable": true }),
            json!({ "version": "0.19.4", "stable": false }),
        ];
        assert_eq!(
            pick_stable_version(&entries),
            Some("0.19.5".to_string())
        );
    }

    #[test]
    fn test_pick_stable_version_reads_nested_loader_entries() {
        let entries = vec![
            json!({ "loader": { "version": "0.19.4", "stable": false }, "intermediary": {} }),
            json!({ "loader": { "version": "0.19.5", "stable": true }, "intermediary": {} }),
        ];
        assert_eq!(
            pick_stable_version(&entries),
            Some("0.19.5".to_string())
        );
    }

    #[test]
    fn test_pick_stable_version_without_stable_entry() {
        let entries = vec![json!({ "version": "0.20.0", "stable": false })];
        assert_eq!(pick_stable_version(&entries), None);
    }
}
