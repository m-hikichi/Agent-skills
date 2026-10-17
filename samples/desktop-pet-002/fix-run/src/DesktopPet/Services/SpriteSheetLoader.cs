using System.Runtime.InteropServices;
using DesktopPet.Models;
using SkiaSharp;

namespace DesktopPet.Services;

/// <summary>1コマ分の画素データ（BGRA8888・非乗算アルファ）とヒットテスト用の不透明マップ。</summary>
public sealed class SpriteFrame
{
    /// <summary>CellWidth * CellHeight * 4 バイトのBGRA画素。</summary>
    public required byte[] Bgra { get; init; }

    /// <summary>クリック透過判定用。alpha &gt; 16 の画素を不透明とみなす。</summary>
    public required bool[] Opaque { get; init; }
}

/// <summary>状態ごとのコマ列に展開済みのスプライトシート。</summary>
public sealed class SpriteSheet
{
    public required IReadOnlyDictionary<PetState, SpriteFrame[]> Frames { get; init; }

    public SpriteFrame GetFrame(PetState state, int frameIndex) => Frames[state][frameIndex];
}

/// <summary>
/// WebP/PNGアトラスをSkiaSharpでデコードし、固定グリッド（8×9・192×208）の
/// コマ画素列とアルファマップへスライスする（UI型に依存しない）。
/// </summary>
public static class SpriteSheetLoader
{
    /// <summary>クリック透過のヒットテストで不透明とみなすアルファしきい値。</summary>
    public const byte AlphaThreshold = 16;

    /// <summary>アトラスファイルの寸法だけを安価に検証する（フルデコードなし）。</summary>
    public static bool TryValidateDimensions(string atlasPath, out string? error)
    {
        try
        {
            using var codec = SKCodec.Create(atlasPath);
            if (codec is null)
            {
                error = $"spritesheet: cannot decode '{Path.GetFileName(atlasPath)}'";
                return false;
            }
            var info = codec.Info;
            if (info.Width != AnimationTable.AtlasWidth || info.Height != AnimationTable.AtlasHeight)
            {
                error = $"spritesheet: expected {AnimationTable.AtlasWidth}x{AnimationTable.AtlasHeight} " +
                        $"but found {info.Width}x{info.Height}";
                return false;
            }
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = $"spritesheet: {ex.Message}";
            return false;
        }
    }

    /// <summary>アトラスをデコードして全9行のコマ列へ展開する。失敗してもスローしない。</summary>
    public static bool TryLoad(string atlasPath, out SpriteSheet? sheet, out string? error)
    {
        sheet = null;
        try
        {
            using var decoded = SKBitmap.Decode(atlasPath);
            if (decoded is null)
            {
                error = $"spritesheet: cannot decode '{Path.GetFileName(atlasPath)}'";
                return false;
            }
            if (decoded.Width != AnimationTable.AtlasWidth || decoded.Height != AnimationTable.AtlasHeight)
            {
                error = $"spritesheet: expected {AnimationTable.AtlasWidth}x{AnimationTable.AtlasHeight} " +
                        $"but found {decoded.Width}x{decoded.Height}";
                return false;
            }

            // BGRA8888・非乗算アルファへ正規化してから全画素を取り出す
            var info = new SKImageInfo(
                AnimationTable.AtlasWidth, AnimationTable.AtlasHeight,
                SKColorType.Bgra8888, SKAlphaType.Unpremul);
            var atlasPixels = new byte[info.BytesSize];
            var handle = GCHandle.Alloc(atlasPixels, GCHandleType.Pinned);
            try
            {
                using var pixmap = decoded.PeekPixels();
                if (pixmap is null ||
                    !pixmap.ReadPixels(info, handle.AddrOfPinnedObject(), info.RowBytes, 0, 0))
                {
                    error = "spritesheet: pixel conversion failed";
                    return false;
                }
            }
            finally
            {
                handle.Free();
            }

            var frames = new Dictionary<PetState, SpriteFrame[]>();
            foreach (var row in AnimationTable.All)
            {
                var rowFrames = new SpriteFrame[row.FrameCount];
                for (var col = 0; col < row.FrameCount; col++)
                {
                    rowFrames[col] = ExtractCell(atlasPixels, row.RowIndex, col);
                }
                frames[row.State] = rowFrames;
            }

            sheet = new SpriteSheet { Frames = frames };
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = $"spritesheet: {ex.Message}";
            return false;
        }
    }

    private static SpriteFrame ExtractCell(byte[] atlasBgra, int rowIndex, int columnIndex)
    {
        var (cellX, cellY, w, h) = AnimationTable.CellRect(rowIndex, columnIndex);
        var bgra = new byte[w * h * 4];
        var opaque = new bool[w * h];
        var atlasStride = AnimationTable.AtlasWidth * 4;

        for (var y = 0; y < h; y++)
        {
            var srcOffset = (cellY + y) * atlasStride + cellX * 4;
            var dstOffset = y * w * 4;
            Buffer.BlockCopy(atlasBgra, srcOffset, bgra, dstOffset, w * 4);
            for (var x = 0; x < w; x++)
            {
                opaque[y * w + x] = bgra[dstOffset + x * 4 + 3] > AlphaThreshold;
            }
        }

        return new SpriteFrame { Bgra = bgra, Opaque = opaque };
    }

    /// <summary>
    /// 非乗算 BGRA を乗算済み BGRA へ変換する（色 × アルファ ÷ 255、四捨五入）。
    /// 拡大縮小して描画するコマ画像に使う。非乗算のまま補間すると、透明画素の色が輪郭に混ざって
    /// キャラクターの縁にフチが出る（specs/002-idle-run-pet-resize/research.md §7）。
    /// </summary>
    public static byte[] Premultiply(byte[] bgra)
    {
        var result = new byte[bgra.Length];
        for (var i = 0; i + 3 < bgra.Length; i += 4)
        {
            int alpha = bgra[i + 3];
            result[i] = (byte)((bgra[i] * alpha + 127) / 255);
            result[i + 1] = (byte)((bgra[i + 1] * alpha + 127) / 255);
            result[i + 2] = (byte)((bgra[i + 2] * alpha + 127) / 255);
            result[i + 3] = (byte)alpha;
        }
        return result;
    }
}
