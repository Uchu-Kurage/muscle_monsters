# 分岐進化スプライトの差し替えガイド

第3形態（Lv≥10）に到達したモンスターは、トレーニング傾向に応じて 3 つの「型」へ
**分岐進化**します。型ごとに専用スプライトを表示します。

## 命名規則

```
public/assets/{muscle}_3_{branch}.png
```

- `{muscle}` … 筋肉ID（例: `chest`, `back`, `legs` …。`src/App.tsx` の `MuscleType` を参照）
- `{branch}` … 型
  - `power`     … パワー型（⚔️ 低レップ・高重量）
  - `endurance` … 持久型（🌀 高レップ）
  - `balanced`  … バランス型（⭐ 中レップ／データ不足時の既定）

例:
- `chest_3_power.png`
- `chest_3_endurance.png`
- `chest_3_balanced.png`

## 差し替え方法

- **上記の同名ファイルを上書きするだけ**で、進化モーダル・モンスターカード・詳細
  モーダル・記録結果・記録タブのプレビューすべてに反映されます（コード変更は不要）。
- 現在配置されているのは**仮画像**（各 `{muscle}_3.png` をコピーしたもの）です。
- 推奨サイズ・形式は既存スプライトに準拠（正方形の透過 PNG、ピクセルアート）。
- 万一ファイルが無い／読み込めない場合は、自動的に `{muscle}_3.png` にフォールバック
  表示されます（画像が壊れて見えることはありません）。

## 対象一覧（19 筋肉 × 3 型 = 57 ファイル）

対象筋肉:
`chest`, `back`, `shoulder`, `biceps`, `triceps`, `brachioradialis`,
`forearm_flexors`, `glutes`, `legs`, `hamstrings`, `gluteus_medius`,
`adductors`, `abs`, `obliques`, `iliopsoas`, `transversus_abdominis`,
`trapezius`, `erector_spinae`, `rhomboids`

各筋肉について `_3_power.png` / `_3_endurance.png` / `_3_balanced.png` の 3 枚。
