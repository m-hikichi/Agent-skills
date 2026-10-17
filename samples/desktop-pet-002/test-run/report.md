# 現行アプリの自動テスト実測結果

初回実施日: 2026-09-27（JST）。再実施日: 2026-10-12（JST）。過去のQA記録の転記ではなく、コピーしたコードで実行した結果です。

## 2026-10-12の再確認

最初に保存済みTRXと現行ソースの対応を確認し、その後、同じ安全なコピー内で3群を再実行しました。2026-09-27のTRXを残し、今回のTRXは別名に保存しました。

- 元プロジェクトの既存`src/`・`tests/`の36ファイルを、bin/obj/ビルド生成領域を除外してSHA-256で再比較しました。欠落・内容不一致は0件でした。
- 逆方向にも一覧を照合し、コピーだけにあるファイルは追加試験の`ClarifiedSettingsDecisionTests.cs`と`InstalledPetCompatibilityTests.cs`の2件のみでした。既存ファイルの消失を見逃す片方向比較だけにはしていません。
- 2ペットの`spritesheet.webp`のSHA-256は、末尾に記録した実行時の値と一致しました。
- 保存済みTRXをXMLとして再読込し、173件成功、追加決定試験4件中1成功・3失敗、ペット補助試験8件成功を確認しました。
- 現在の`contracts/app-settings.md`54–55・83行および`spec.md`294行以降には、型不一致でも位置・ペットを保持する決定②が反映されています。現行実装は変わっていないため、記録済み3失敗は引き続きこの実装に対する不適合証拠です。
- 現在の`spec.md`280行にはOS表示倍率変更時の補正規則が反映されています。決定③のイベント処理の実装も前回と同一です。下記のコード上の疑義は残りますが、実機失敗を新たに観測したわけではありません。

再実行も前回と同じ結果でした。`--no-restore`でネットワーク復元せず、SDK証明書生成・SDKテレメトリー・Avaloniaビルド統計を無効化し、元設定にアクセスするアプリ画面は起動していません。

| 2026-10-12の再実行 | 合格 | 失敗 | スキップ | 今回の証跡 |
|---|---:|---:|---:|---|
| 既存試験（追加2クラスを除外） | 173 | 0 | 0 | [baseline-2026-10-12.trx](results/baseline-2026-10-12.trx) |
| 決定②の追加試験 | 1 | 3 | 0 | [clarified-settings-2026-10-12.trx](results/clarified-settings-2026-10-12.trx) |
| 全2ペット×4サイズの補助試験 | 8 | 0 | 0 | [installed-pets-2026-10-12.trx](results/installed-pets-2026-10-12.trx) |

決定②の不適合は今回も実行で再現しています。この再実行も未実施の画面・長時間・人による試験の代替にはなりません。各群は独立実行で、決定②のコマンド終了コードは1、他の2群は0でした。

## 結論

既存テスト173件はすべて成功しました。ただし新たな決定②には現行実装が適合しません。新しい期待を確認する追加4ケースのうち、サイズだけは成功し、選択ペット・X座標・Y座標の保持の3ケースが失敗しました。既存テストの全成功は、新しい仕様全体への適合を意味しません。

| 実行 | 合格 | 失敗 | スキップ | 今回の証跡 |
|---|---:|---:|---:|---|
| 現行の既存自動テスト | 173 | 0 | 0 | [baseline.trx](results/baseline.trx) |
| 決定②: 文字列サイズ値の復旧 | 1 | 3 | 0 | [clarified-settings.trx](results/clarified-settings.trx) |
| 2ペット×4サイズの読み込み・計算 | 8 | 0 | 0 | [installed-pets.trx](results/installed-pets.trx) |

TRX記録上の実行時間帯は順に12:02:34–12:02:36、12:03:05–12:03:06、12:04:28–12:04:29です。

## 実行範囲・元資料の保護

- 元プロジェクト: `C:/Users/m_hikichi/Documents/desktop-pet`。
- `AGENTS.md`を確認し、元の`src/`・`tests/`・solutionをこの`test-run/`へコピーしました。元プロジェクトの実装・テスト・設定ファイルは編集していません。
- コピー時にbin/obj等を除外。実行後に元ファイルとコピーのSHA-256を比較し、コピーした既存src/testsの不一致は0件でした。追加テスト2ファイルだけがコピー内に存在します。
- 設定試験は既存`TempDir`が生成する一時ディレクトリを明示指定し、利用者の`settings.json`を読み書きしません。
- アプリ画面は起動せず、クリック・ドラッグ・DPI変更・画面ロックも実施していません。
- SDK: 元プロジェクトのポータブル.NET 10.0.401。Release構成。NuGetは既存ローカルキャッシュから復元しました。
- ビルドでは既存のAVLN3001警告（PetWindowの公開コンストラクターなし）が出ています。テストの失敗ではありません。

## 決定②の不適合（実行で再現）

入力は次の設定です。

```json
{"schemaVersion":1,"selectedPetId":"genba-neko","positionX":900,"positionY":400,"scalePercent":"big"}
```

| 確認対象 | 新しい期待 | 実際の値 | 判定 |
|---|---|---|---|
| サイズ | Medium 100% | Medium 100% | 合格 |
| 選択ペット | genba-nekoを保持 | null | 不合格 |
| X座標 | 900を保持 | null | 不合格 |
| Y座標 | 400を保持 | null | 不合格 |

`SettingsService.Load`は`JsonSerializer.Deserialize<AppSettings>`を使用します。`AppSettings.ScalePercent`が`int?`のため文字列で例外となり、catchで`new AppSettings()`を返します。既存の`Load_ScalePercentOfWrongType_FallsBackToDefaultsWithoutThrowing`は、旧契約どおりペットがnullになることを期待しています。今回、その既存試験は変更せず、新しい期待を[ClarifiedSettingsDecisionTests.cs](tests/DesktopPet.Tests/ClarifiedSettingsDecisionTests.cs)として追加しました。

## 決定③の実装上の疑義（コード確認のみ）

`PetWindow.axaml.cs`の`OnScalingChanged`（191行付近）は補間設定を更新し、位置初期化済み・非ドラッグ中なら`ApplyPosition`を呼びます。この経路には、はみ出した場合に限る補正処理がありません。

一方、別イベントの`OnScreensChanged`（384行付近）には`ClampTopLeft`による補正があります。このOS・フレームワークが倍率変更時に両イベントをどの順で発火するかは今回実機で確認していません。したがって、**決定③を満たすと確認できない実装上の疑義**であり、「実機で必ず失敗した」とは報告しません。倍率変更後の画面内・はみ出し条件を実機で確認する必要があります。

## TST-108に対応する補助証跡

利用可能な設置済みペットは`C:/Users/m_hikichi/.codex/pets`の次の2種類でした。同じIDのパッケージが元リポジトリの`.hatch-pet/packages`にもあります。今回の読み込み対象はユーザー配置側の2パッケージです。

| ペットID | 表示名 | 75% | 100% | 125% | 150% |
|---|---|---|---|---|---|
| genba-neko | 現場ねこ | 成功 | 成功 | 成功 | 成功 |
| yoshi-cat | Yoshi Cat | 成功 | 成功 | 成功 | 成功 |

[InstalledPetCompatibilityTests.cs](tests/DesktopPet.Tests/InstalledPetCompatibilityTests.cs)で既存の`PetDiscoveryService`・`SpriteSheetLoader`・`CharacterLayout`を使用しました。8ケースそれぞれで、元WebPの読み込み、全アニメーション行の規定コマ数、各コマの192×208画素分のデータと透明判定配列、サイズ計算を検査しました。期待寸法は順に144×156、192×208、240×260、288×312 DIPです。

各ケースの前後でpet.jsonとspritesheet.webpのSHA-256一致を検査しています。画像は読み込み・メモリ内展開だけで、画像ファイルの加工・保存はしていません。

これはTST-108の**形式互換性・読み込み・寸法計算の補助検査**です。実画面の輪郭、コマ進行、描画品質、クリック透過、ペット切替を実行した証拠ではなく、TST-108全体を実施済み・合格にはしません。

## 未実施

- 初めて使う人3人による操作・発見性の試験。
- 8時間の連続稼働試験。
- 実画面での全ペット・全サイズの確認、性能測定、ドラッグ、メニュー操作、実際のDPI変更、マルチモニタ移動。
- 新しい決定②・③に対応するアプリ実装修正（この作業では依頼範囲外）。

## 再実行

`DOTNET_CLI_HOME`はこのフォルダー配下の`.dotnet-home`へ設定します。`DOTNET_CLI_TELEMETRY_OPTOUT=1`、`DOTNET_GENERATE_ASPNET_CERTIFICATE=false`を設定します。初回復元には`-p:RestoreSources=C:/Users/m_hikichi/.nuget/packages -p:NuGetAudit=false`を使用しました。以後は`--no-restore`を指定します。

```powershell
dotnet test DesktopPet.slnx -c Release --no-restore --filter 'FullyQualifiedName!~ClarifiedSettingsDecisionTests&FullyQualifiedName!~InstalledPetCompatibilityTests' --logger 'trx;LogFileName=baseline-rerun.trx' --results-directory results '-p:UsedAvaloniaProducts='
dotnet test DesktopPet.slnx -c Release --no-restore --filter 'FullyQualifiedName~ClarifiedSettingsDecisionTests' --logger 'trx;LogFileName=clarified-settings-rerun.trx' --results-directory results '-p:UsedAvaloniaProducts='
dotnet test DesktopPet.slnx -c Release --no-restore --filter 'FullyQualifiedName~InstalledPetCompatibilityTests' --logger 'trx;LogFileName=installed-pets-rerun.trx' --results-directory results '-p:UsedAvaloniaProducts='
```

`dotnet`には元プロジェクトの`.dotnet/dotnet.exe`を指定できます。空の`UsedAvaloniaProducts`は、外部ユーザープロファイルへ書き込むAvaloniaのビルド統計タスクを無効化するために指定しました。アプリの実装は変更しません。

初回試行は未対応の`--ignore-failed-sources`で失敗し、次の試行はネットワーク復元が利用できず中断しました。ローカル復元後の初回ビルドはAvalonia統計ログへのアクセス拒否で失敗したため、上記オプションで無効化して再実行しました。これらはアプリテストの失敗件数には含めません。

またSDK初回起動メッセージにHTTPS開発証明書のインストール表示がありました。利用者のアプリ設定変更とは別のSDK初期化による副作用です。証明書の実在・保存先は未確認で、以後は証明書生成を無効化しました。既存証明書を誤って消さないため削除操作はしていません。

## 確認した実装の指紋

- `SettingsService.cs`: `4188E2C6866B9AA7516EFE0176F2FEDDCB1AB1E3AC3631F4EF23FDB37D40E4C7`
- `PetWindow.axaml.cs`: `E6507D79D73297678F34F9FDA16290DA4019395AA6D81CF2C8264FE86FE5EC79`
- genba-neko `spritesheet.webp`: `96F07E0F599A52AB3AA4DC9744502623908103285427A318A95E0259E53691C4`
- yoshi-cat `spritesheet.webp`: `B97393D141A639B0A3B58007DB64261FC067968F3F3C766CACCC51437A32BEFC`
