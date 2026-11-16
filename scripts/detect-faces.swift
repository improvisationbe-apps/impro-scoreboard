// Analyse des photos de joueurs (src/assets/joueurs/<joueur>/) avec le framework Vision de macOS.
// Écrit src/assets/data/face-positions.json :
//
//   "assets/joueurs/polo-lions": { "x": 46, "y": 37 }
//
//   x, y  : centre du visage, en % de la photo (cadrage : object-position / transform-origin)
//
// La clé est le chemin sans extension, comme PlayerMetadata.imgKey().
// Usage : npm run faces:detect   (compile puis exécute ; macOS uniquement, aucune dépendance)
import Foundation
import CoreImage
import Vision

let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("../..").standardized
let photosDir = root.appendingPathComponent("src/assets/joueurs")
let output = root.appendingPathComponent("src/assets/data/face-positions.json")
let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "webp"]

struct Face: Encodable {
    var x: Int
    var y: Int
}

// Un dossier par joueur : on parcourt les sous-dossiers ; la clé reste "assets/joueurs/<nom sans extension>".
let fm = FileManager.default
let files = try fm.contentsOfDirectory(at: photosDir, includingPropertiesForKeys: [.isDirectoryKey])
    .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
    .flatMap { (try? fm.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)) ?? [] }
    .filter { imageExtensions.contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }

var positions: [String: Face] = [:]

for file in files {
    let key = "assets/joueurs/" + file.deletingPathExtension().lastPathComponent
    guard let image = CIImage(contentsOf: file, options: [.applyOrientationProperty: true]) else {
        print("  SKIP (illisible) : \(file.lastPathComponent)")
        continue
    }
    let request = VNDetectFaceRectanglesRequest()
    request.revision = VNDetectFaceRectanglesRequestRevision3
    try VNImageRequestHandler(ciImage: image, options: [:]).perform([request])

    // Plusieurs visages (fond, spectateur…) : on garde le plus grand.
    guard let face = request.results?.max(by: { $0.boundingBox.height < $1.boundingBox.height }) else {
        positions[key] = Face(x: 50, y: 15)
        print("  NO FACE \(file.lastPathComponent) -> 50% 15%")
        continue
    }
    let box = face.boundingBox // normalisé, origine en bas à gauche
    let result = Face(x: Int((box.midX * 100).rounded()),
                      y: Int(((1 - box.midY) * 100).rounded()))
    positions[key] = result
    print(String(format: "  OK %-36@ x=%3d%% y=%3d%%", file.lastPathComponent, result.x, result.y))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let json = String(data: try encoder.encode(positions), encoding: .utf8)! + "\n"
try json.write(to: output, atomically: true, encoding: .utf8)
print("\n\(positions.count) entrées écrites dans face-positions.json")
