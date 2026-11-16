import Foundation
import CoreImage
import Vision

// Détourage d'une photo de joueur : npm run photos:cutout -- src/assets/joueurs/<joueur>/<nom>.jpg
// Écrit <nom>.png à côté (le manifeste photos.json préfère ensuite le PNG). Options : [t0 t1 bande érosion debugFond.png]
// Les réglages par défaut dépendent du fond (noir ou clair). Cheveux très clairs sur fond noir : essayer 0.20 1.2 40 25.
// Détourage Vision affiné autour de la tête : le fond (uni ou dégradé) est estimé localement en
// excluant le sujet ; dans une bande autour de la silhouette, l'opacité d'un pixel dépend de son écart
// à ce fond local. Les mèches ressortent, le liseré de fond disparaît.
let args = CommandLine.arguments
let inURL = URL(fileURLWithPath: args[1])
let outURL = args.count > 2 && args[2].hasSuffix(".png") ? URL(fileURLWithPath: args[2]) : inURL.deletingPathExtension().appendingPathExtension("png")
let optOffset = args.count > 2 && args[2].hasSuffix(".png") ? 0 : -1
// Réglages : explicites en argument, sinon choisis d'après la luminosité du fond (voir plus bas).
let argT0 = args.count > 3 + optOffset ? Double(args[3 + optOffset]) : nil
let argT1 = args.count > 4 + optOffset ? Double(args[4 + optOffset]) : nil
let argBand = args.count > 5 + optOffset ? Double(args[5 + optOffset]) : nil
let argErosion = args.count > 6 + optOffset ? Double(args[6 + optOffset]) : nil
let debugBg = args.count > 7 + optOffset ? args[7 + optOffset] : nil

let ctx = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
guard let input = CIImage(contentsOf: inURL, options: [.applyOrientationProperty: true, .colorSpace: NSNull()]) else {
    fputs("Cannot read input\n", stderr); exit(1)
}
let extent = input.extent
let scale = extent.height / 3000.0

func gray(_ v: CGFloat) -> CIImage { CIImage(color: CIColor(red: v, green: v, blue: v)).cropped(to: extent) }
func crop(_ i: CIImage) -> CIImage { i.cropped(to: extent) }
func dilate(_ i: CIImage, _ r: Double) -> CIImage { crop(i.applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": r * scale])) }
func erode(_ i: CIImage, _ r: Double) -> CIImage { crop(i.applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": r * scale])) }
func blur(_ i: CIImage, _ r: Double) -> CIImage { crop(i.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: ["inputRadius": r * scale])) }
func mul(_ a: CIImage, _ b: CIImage) -> CIImage { a.applyingFilter("CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: b]) }
func maxc(_ a: CIImage, _ b: CIImage) -> CIImage { a.applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: b]) }
func invert(_ i: CIImage) -> CIImage { crop(i.applyingFilter("CIColorInvert")) }

// 1. Masque du sujet + visage
let maskRequest = VNGenerateForegroundInstanceMaskRequest()
let faceRequest = VNDetectFaceRectanglesRequest()
let handler = VNImageRequestHandler(ciImage: input, options: [:])
try handler.perform([maskRequest, faceRequest])
guard let result = maskRequest.results?.first else { fputs("No foreground found\n", stderr); exit(2) }
let mask = crop(CIImage(cvPixelBuffer: try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)))

// 2. Fond local : moyenne floue des pixels hors sujet (convolution normalisée)
let outside = invert(dilate(mask, 30))                      // 1 hors sujet, 0 dessus
let blurredWeighted = blur(mul(input, outside), 120)
let blurredWeight = blur(outside, 120).applyingFilter("CIColorClamp", parameters: [
    "inputMinComponents": CIVector(x: 0.02, y: 0.02, z: 0.02, w: 1),
    "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1)]).cropped(to: extent)
// CIDivideBlendMode : fond / source, donc (image x hors-sujet floutée) / (hors-sujet flouté)
let bgLocal = crop(blurredWeight.applyingFilter("CIDivideBlendMode", parameters: [kCIInputBackgroundImageKey: blurredWeighted]))
if let debugBg {
    try ctx.writePNGRepresentation(of: bgLocal, to: URL(fileURLWithPath: debugBg), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, options: [:])
}

// Préréglages : sur fond noir, les pixels de bord mélangés au fond sont très assombris, il faut une érosion
// plus forte et une rampe d'opacité plus large (la décontamination les éclaircit ensuite) ; sur fond clair
// un réglage plus doux suffit.
func averageLuminance(_ image: CIImage, in rect: CGRect) -> Double {
    let avg = image.applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: rect)])
    var px = [UInt8](repeating: 0, count: 4)
    ctx.render(avg, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
    return (0.299 * Double(px[0]) + 0.587 * Double(px[1]) + 0.114 * Double(px[2])) / 255
}
let bgLuminance = averageLuminance(input, in: CGRect(x: extent.minX + 10, y: extent.maxY - 60, width: 50, height: 50))
let darkBackground = bgLuminance < 0.25
let t0 = argT0 ?? (darkBackground ? 0.15 : 0.10)
let t1 = argT1 ?? (darkBackground ? 0.70 : 0.35)
let band = argBand ?? 40
let erosion = argErosion ?? (darkBackground ? 15 : 10)
print(String(format: "fond %@ (luminance %.2f) : t0=%.2f t1=%.2f bande=%.0f érosion=%.0f", darkBackground ? "sombre" : "clair", bgLuminance, t0, t1, band, erosion))

// 3. Opacité par écart au fond local (somme des écarts RVB : fond -> 0, au-delà de t1 -> 1)
let diff = input.applyingFilter("CIDifferenceBlendMode", parameters: [kCIInputBackgroundImageKey: bgLocal])
let dist = diff.applyingFilter("CIColorMatrix", parameters: [
    "inputRVector": CIVector(x: 1, y: 1, z: 1, w: 0),
    "inputGVector": CIVector(x: 1, y: 1, z: 1, w: 0),
    "inputBVector": CIVector(x: 1, y: 1, z: 1, w: 0),
    "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1)])
let keyAlpha = dist.applyingFilter("CIColorPolynomial", parameters: [
    "inputRedCoefficients": CIVector(x: -t0 / (t1 - t0), y: 1 / (t1 - t0), z: 0, w: 0),
    "inputGreenCoefficients": CIVector(x: -t0 / (t1 - t0), y: 1 / (t1 - t0), z: 0, w: 0),
    "inputBlueCoefficients": CIVector(x: -t0 / (t1 - t0), y: 1 / (t1 - t0), z: 0, w: 0)])
    .applyingFilter("CIColorClamp", parameters: [
        "inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 0),
        "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1)]).cropped(to: extent)

// 4. Zone de la tête : cœur du masque érodé + pixels "non fond" dans la bande autour de la silhouette
let refined = crop(maxc(erode(mask, erosion), mul(keyAlpha, dilate(mask, band))))
var finalMask = mask
if let face = faceRequest.results?.max(by: { $0.boundingBox.height < $1.boundingBox.height }) {
    let b = face.boundingBox
    let chinY = (b.minY - b.height * 0.15) * extent.height
    let headRect = CGRect(x: 0, y: chinY, width: extent.width, height: extent.height - chinY)
    finalMask = crop(refined.cropped(to: headRect).composited(over: mask))
} else {
    finalMask = refined
    print("no face: refinement applied everywhere")
}

// 5. Décontamination des bords : un pixel semi-transparent observé = a·couleur + (1-a)·fond,
//    on retrouve la couleur = (observé - (1-a)·fond) / a, sinon les cheveux gardent un liseré de la couleur du fond.
let bgPart = mul(bgLocal, invert(finalMask))
let numerator = crop(input.applyingFilter("CIDifferenceBlendMode", parameters: [kCIInputBackgroundImageKey: bgPart]))
let safeMask = finalMask.applyingFilter("CIColorClamp", parameters: [
    "inputMinComponents": CIVector(x: 0.05, y: 0.05, z: 0.05, w: 1),
    "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1)]).cropped(to: extent)
let decontaminated = crop(safeMask.applyingFilter("CIDivideBlendMode", parameters: [kCIInputBackgroundImageKey: numerator]))
    .applyingFilter("CIColorClamp", parameters: [
        "inputMinComponents": CIVector(x: 0, y: 0, z: 0, w: 0),
        "inputMaxComponents": CIVector(x: 1, y: 1, z: 1, w: 1)]).cropped(to: extent)

// 6. Découpe
let blend = CIFilter(name: "CIBlendWithMask")!
blend.setValue(decontaminated, forKey: kCIInputImageKey)
blend.setValue(CIImage.empty(), forKey: kCIInputBackgroundImageKey)
blend.setValue(finalMask, forKey: kCIInputMaskImageKey)
try ctx.writePNGRepresentation(of: blend.outputImage!.cropped(to: extent), to: outURL, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, options: [:])
print("ok \(outURL.lastPathComponent) \(Int(extent.width))x\(Int(extent.height))")
