fn main() {
    let elf = std::fs::read("/Users/yigitberhangulabigul/telegram-claude-workspace/logos-core/target/riscv32im-risc0-zkvm-elf/docker/logos_core.bin").unwrap();
    let binary = risc0_binfmt::ProgramBinary::decode(&elf).unwrap();
    let digest = binary.compute_image_id().unwrap();
    let words: Vec<u32> = digest.as_words().iter().copied().collect();
    println!("Program ID [u32; 8]: {:?}", words);
    let hex: String = words.iter().flat_map(|w| w.to_le_bytes()).map(|b| format!("{:02x}", b)).collect();
    println!("Image ID (LE bytes):  {hex}");
    let hex2: String = words.iter().map(|w| format!("{:08x}", w)).collect();
    println!("Image ID (per-word):  {hex2}");
}
