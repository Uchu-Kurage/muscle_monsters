# ポーズ専用スプライトの差し替えガイド

ボディビル大会（大会タブ）では、規定ポーズごとに**専用スプライト**を表示します。
ポージング画面のメイン画像に使われます。

## 命名規則

```
public/assets/pose_{poseId}.jpg
```

- `{poseId}` … 規定ポーズID（`src/App.tsx` の `CONTEST_POSES` を参照）

対象の7ポーズ:

- `pose_front_double_biceps.jpg` … フロント・ダブルバイセップス
- `pose_front_lat_spread.jpg` … フロント・ラットスプレッド
- `pose_side_chest.jpg` … サイドチェスト
- `pose_side_triceps.jpg` … サイド・トライセップス
- `pose_back_double_biceps.jpg` … バック・ダブルバイセップス
- `pose_abdominals_thighs.jpg` … アブドミナル＆サイ
- `pose_most_muscular.jpg` … モスト・マスキュラー

## 差し替え方法

- **上記の同名ファイルを上書きするだけ**で、大会画面に反映されます
  （コード変更は不要）。
- 現在配置されているのは実写のポージング写真（縦長）です。
- `PoseSprite` は `size` を**高さの上限**として、アスペクト比を保ったまま
  表示します（`objectFit: contain`）。縦長・横長どちらの画像でも潰れません。
- 推奨は縦長の JPEG（高さ 700px 前後、80% 品質程度）。1 枚あたり数十 KB に
  収めるとバンドルが軽く保てます。
- 万一ファイルが無い／読み込めない場合は、自動的にそのポーズの**絵文字**へ
  フォールバック表示されます（画像が壊れて見えることはありません。`PoseSprite` 参照）。
