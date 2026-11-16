// End-to-end checks against a real Minecraft install (run by hand: they need a client jar, a server jar and Java).
//   TC_SMOKE=1 HOME=<fake home with .minecraft/versions/<v>/<v>.jar> cargo test smoke -- --ignored --nocapture
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use crate::{assets, generator, java};

#[test]
#[ignore]
fn smoke_real_minecraft() {
    let jars = assets::newest_jars();
    println!("jars: {jars:?}");
    let jar = jars.first().expect("no Minecraft jar found");
    let bundle = assets::load_jar(jar).expect("load jar");
    let count = |k: &str| bundle[k].as_object().map(|o| o.len()).or(bundle[k].as_array().map(|a| a.len())).unwrap_or(0);
    println!(
        "version {} blockstates {} models {} biomes {} textures {} structures {}",
        bundle["version"], count("blockstates"), count("models"), count("biomes"), count("textures"), count("structures")
    );
    std::fs::write("/tmp/tc-bundle.json", bundle.to_string()).unwrap();
    assert!(count("blockstates") > 500 && count("models") > 1000 && count("biomes") > 50 && count("textures") > 1000);
    assert!(bundle["biomes"]["plains"]["effects"]["sky_color"].is_number(), "{}", bundle["biomes"]["plains"]);
    assert!(assets::read_asset("textures/block/stone.png").is_some());
    assert!(assets::read_structure("igloo/top").is_some());
    println!("entity textures {}", assets::entity_texture_sizes().len());
    println!("obfuscated {}", assets::is_obfuscated());
    let v = assets::current_version();
    let need = java::required_java(&v);
    let j = java::find_java(need).expect("java");
    println!("java {} {} (need {need})", j.path, j.major);

    let progress: generator::Progress = Arc::new(|s, m| println!("[{s}] {m}"));
    let req = |seed: &str, biome: &str| {
        serde_json::from_value::<generator::GenerateRequest>(serde_json::json!({
            "version": v, "dimension": "overworld", "biome": biome, "size": 32, "seed": seed, "acceptEula": true
        }))
        .unwrap()
    };
    let t0 = std::time::Instant::now();
    let packed = generator::generate(req("thumbcraft", "desert"), progress.clone(), Arc::new(AtomicBool::new(false))).expect("generate");
    println!("generated {} bytes in {:?}", packed.len(), t0.elapsed());
    assert!(crate::anvil::Terrain::packed_is_valid(&packed));
    std::fs::write("/tmp/tc-terrain.bin", &packed).unwrap();
    // Second time: from the cache.
    let t1 = std::time::Instant::now();
    let again = generator::generate(req("thumbcraft", "desert"), progress.clone(), Arc::new(AtomicBool::new(false))).unwrap();
    assert_eq!(again, packed);
    println!("cached in {:?}", t1.elapsed());
    // Cancel straight away.
    let cancel = Arc::new(AtomicBool::new(true));
    let e = generator::generate(req("other seed", "plains"), progress, cancel).unwrap_err();
    assert_eq!(e, generator::CANCELLED);
    generator::shutdown(true);
}
