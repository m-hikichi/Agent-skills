# Third-party notices and usage reminders

JSON Video Studio `0.1.0`は個人用ローカルプラグインです。このファイルは法的助言や完全なライセンス一覧ではありません。Docker imageをbuildした環境で、各パッケージの実際のversion、配布物、`ffmpeg -buildconf`、npm lockfileも確認してください。

## Remotion

- Project: <https://www.remotion.dev/>
- Version pinned by this plugin: `4.0.503`
- Terms and pricing: <https://www.remotion.dev/docs/license/pricing>

Remotionは利用者数、組織規模、共同作業、自動動画生成サービスなどにより条件が変わります。個人利用からチーム利用、顧客向け自動化、SaaS、一般公開へ用途を変える前に現行条件を再確認してください。

## FFmpeg / ffprobe

- Project: <https://ffmpeg.org/>
- Legal information: <https://ffmpeg.org/legal.html>

FFmpegの適用条件はbuild configurationと組み込まれたcodecに依存します。このプラグインはDebian packageをDocker image内で使用します。imageやbinaryを第三者へ再配布する場合は、実際のbuild configuration、対応するソース提供義務、LGPL/GPL条件を確認してください。

## VOICEVOX Engine and voices

- Engine: <https://github.com/VOICEVOX/voicevox_engine>
- API: <https://voicevox.github.io/voicevox_engine/api/>
- Engine image pinned by default: `voicevox/voicevox_engine:cpu-ubuntu24.04-0.25.1`

Engineのソフトウェアライセンスと、音声モデル・キャラクターごとの利用規約は別です。利用するspeakerの規約、禁止事項、クレジット表記を利用者が確認してください。JSON Video Studioは既知の表記を`credits.txt`へ出力しますが、適法性を保証しません。

## Noto Sans JP / Noto CJK

- Project: <https://github.com/notofonts/noto-cjk>
- License: SIL Open Font License 1.1

Docker imageのDebian `fonts-noto-cjk`および`fonts-noto-mono` packagesを利用します。v0.1の`theme.fontFamily`は再現性のため`Noto Sans CJK JP`固定で、カスタムfontは未対応です。将来カスタムfont対応を追加する場合は、そのfontのライセンスと帰属表記もproject JSONと成果物へ記録してください。

## Chromium

- Project: <https://www.chromium.org/>
- Licenses: <https://chromium.googlesource.com/chromium/src/+/main/LICENSE>

Remotionのframe rendering用としてDocker image内のDebian Chromium packageを利用します。Chromiumには複数のthird-party componentが含まれます。image再配布時はDebian packageのcopyright metadataも保持してください。

## npm dependencies

正確なdependency versionsは`runtime/package-lock.json`が正本です。配布前にSBOMまたはlicense reportをlockfileから生成し、third-party noticesを更新してください。
