# ポーズ専用スプライトの差し替えガイド

ボディビル大会（大会タブ）では、規定ポーズごとに**専用スプライト**を表示します。
ポージング画面のメイン画像と、審査結果のポーズ別スコア一覧に使われます。

## 命名規則

```
public/assets/pose_{poseId}.png
```

- `{poseId}` … 規定ポーズID（`src/App.tsx` の `CONTEST_POSES` を参照）

対象の7ポーズ:

- `pose_front_double_biceps.png` … フロント・ダブルバイセップス
- `pose_front_lat_spread.png` … フロント・ラットスプレッド
- `pose_side_chest.png` … サイドチェスト
- `pose_side_triceps.png` … サイド・トライセップス
- `pose_back_double_biceps.png` … バック・ダブルバイセップス
- `pose_abdominals_thighs.png` … アブドミナル＆サイ
- `pose_most_muscular.png` … モスト・マスキュラー

## 差し替え方法

- **上記の同名ファイルを上書きするだけ**で、大会画面すべてに反映されます
  （コード変更は不要）。
- 現在配置されているのは**仮画像**（レトロ調のピクセルアートのポーズ人形）です。
- 推奨サイズ・形式は既存スプライトに準拠（正方形の透過 PNG、ピクセルアート）。
- 万一ファイルが無い／読み込めない場合は、自動的にそのポーズの**絵文字**へ
  フォールバック表示されます（画像が壊れて見えることはありません。`PoseSprite` 参照）。
